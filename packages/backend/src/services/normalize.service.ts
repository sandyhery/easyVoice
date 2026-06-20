/**
 * TTS 文本归一化
 *
 * 把 TTS 经常读错的"非自然语言"形式（数字、百分号、货币、英文缩写、
 * URL、邮箱、十六进制/科学计数法等）转换成 TTS 友好的中文/英文读法。
 *
 * 设计目标：
 * - 不依赖任何 NLP 模型，0 字节部署成本（与你的 Edge-TTS / 离线模型路线兼容）
 * - 输入 = 原始文本，输出 = 归一化文本，调用方零感知
 * - 处理顺序：先标点/URL → 再数字（含百分号、货币、负数、小数、科学计数法）
 *   → 再英文缩写/单位 → 最后清理多余空格
 * - 已用 `splitText` 之前；同一段文本归一化前后 cacheKey 不同（因为 input 是同一
 *   段文本，cache 是按 (text, voice, rate, pitch, volume) 生成的，所以语义不变）
 *
 * 参考 AngeVoice 的 ZipVoice 数字/货币归一化思路，针对中文小说常见形式做扩展。
 */

// 中文数字映射表（0-9999）
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
const CN_UNITS = ['', '十', '百', '千']
const CN_BIG_UNITS = ['', '万', '亿', '兆']

/**
 * 整数 0-9999 转中文
 * 1024 -> "一千零二十四"
 */
function intToCn(n: number): string {
  if (n === 0) return CN_DIGITS[0]
  if (n < 10) return CN_DIGITS[n]
  if (n < 20) return n === 10 ? '十' : '十' + CN_DIGITS[n - 10]

  let result = ''
  let unit = 0
  let prevZero = false
  const digits = n.toString().split('').map(Number)
  for (let i = 0; i < digits.length; i++) {
    const d = digits[digits.length - 1 - i]
    if (d === 0) {
      prevZero = true
    } else {
      if (prevZero) result = CN_DIGITS[0] + result
      result = CN_DIGITS[d] + CN_UNITS[i] + result
      prevZero = false
    }
  }
  // 去掉末尾可能残留的 "零"（如 1020 -> "一千零二十"，不该是 "一千零二十零"）
  if (result.endsWith(CN_DIGITS[0])) result = result.slice(0, -1)
  return result
}

/**
 * 把任意整数（含 > 9999）转中文
 * 12345 -> "一万二千三百四十五"
 * 100000000 -> "一亿"
 */
function bigIntToCn(n: number): string {
  if (n === 0) return CN_DIGITS[0]
  if (n < 0) return '负' + bigIntToCn(-n)

  const parts: string[] = []
  const bigUnits = ['', '万', '亿', '兆']
  let groupIdx = 0
  let rest = Math.floor(n)
  while (rest > 0) {
    const group = rest % 10000
    if (group !== 0) {
      let groupStr = intToCn(group)
      // 处理 "一十X" → "十X"（如 12 应为 "十二" 而非 "一十二"）
      if (groupStr.startsWith('一十') && groupStr.length > 2) {
        groupStr = groupStr.slice(1)
      }
      parts.unshift(groupStr + bigUnits[groupIdx])
    }
    rest = Math.floor(rest / 10000)
    groupIdx++
  }
  return parts.join('')
}

/**
 * 小数部分转中文（逐位读，去掉前导零）
 * 0.14 -> "点一四"
 * 0.5  -> "点五"（不是 "零点五"）
 */
function decimalToCn(decimalStr: string): string {
  const trimmed = decimalStr.replace(/^0+/, '') || '0'
  return '点' + trimmed.split('').map(d => CN_DIGITS[Number(d)]).join('')
}

/**
 * 数字串（含可选小数、负号、科学计数法）转中文读法
 *  - "123"      -> "一百二十三"
 *  - "-12.5"    -> "负十二点五"
 *  - "10000"    -> "一万"
 *  - "1.2e5"    -> "一十二万"  （科学计数法展开后再读）
 *  - "007"      -> "零零七"    （保号语义，避免 TTS 把 007 读成 "七"）
 */
export function numberToCn(raw: string): string {
  let s = raw.trim()
  if (!s) return raw

  // 负号
  let prefix = ''
  if (s.startsWith('-')) {
    prefix = '负'
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }

  // 科学计数法展开：1.2e5 -> 120000
  const sciMatch = /^(\d+(?:\.\d+)?)[eE]([+-]?\d+)$/.exec(s)
  if (sciMatch) {
    const [, mantissa, expStr] = sciMatch
    const exp = Number(expStr)
    const [intPart, decPart = ''] = mantissa.split('.')
    const combined = intPart + decPart
    const decimalShift = decPart.length - exp
    let expanded: string
    if (decimalShift >= 0) {
      expanded = combined.slice(0, combined.length - decimalShift) + '.' + combined.slice(combined.length - decimalShift)
    } else {
      expanded = combined + '0'.repeat(-decimalShift)
    }
    s = expanded.replace(/\.$/, '')
  }

  const [intPart, decPart] = s.split('.')
  let out = prefix + bigIntToCn(Number(intPart || '0'))
  if (decPart !== undefined) {
    out += decimalToCn(decPart)
  }
  return out
}

/**
 * 百分号：12.5% -> "百分之十二点五"
 *         120% -> "百分之一百二十"
 */
export function percentToCn(raw: string): string {
  const m = /^(-?\d+(?:\.\d+)?)%$/.exec(raw.trim())
  if (!m) return raw
  return '百分之' + numberToCn(m[1])
}

/**
 * 货币：¥123 / $123 / 123元 / 123美元
 *  - "¥123"     -> "一百二十三元"
 *  - "$12.5"    -> "十二点五美元"
 *  - "100元"    -> "一百元"
 *  - "￥1200"   -> "一千二百元"
 */
const CN_CURRENCY = [
  { prefix: /^(?:¥|￥)/, suffix: '元' },
  { prefix: /^\$/, suffix: '美元' },
  { prefix: /^€/, suffix: '欧元' },
  { prefix: /^£/, suffix: '英镑' },
  { prefix: /^JP¥|^JPY$/, suffix: '日元' },
]

export function currencyToCn(raw: string): string {
  const s = raw.trim()
  // 后缀形式："123元" / "12.5美元"
  for (const cur of [...CN_CURRENCY, { prefix: null as any, suffix: '元' }]) {
    if (cur.prefix) continue
    const m = /^(-?\d+(?:\.\d+)?)(元|美元|欧元|英镑|日元|块|毛)$/.exec(s)
    if (m) return numberToCn(m[1]) + m[2]
  }
  // 前缀形式
  for (const cur of CN_CURRENCY) {
    const m = new RegExp(`^(${cur.prefix.source})(-?\\d+(?:\\.\\d+)?)$`).exec(s)
    if (m) return numberToCn(m[2]) + cur.suffix
  }
  return raw
}

/**
 * 常见英文/拼音缩写扩展（避免 TTS 一个字母一个字母蹦）
 *  - "API" -> "A P I" / 或干脆 "API" 让 TTS 整体读（不同 TTS 行为不同，默认保留）
 *  - "iOS" -> "i O S"
 *  - "Dr." -> "Doctor"
 *  - "Mr." -> "Mister"
 *  - "St." -> "Saint"
 *
 * 设计为保守策略：只把"末尾带点 + 1-3 字母"这种几乎肯定是缩写的情况展开。
 */
const ABBREV_MAP: Record<string, string> = {
  'Dr.': 'Doctor',
  'Mr.': 'Mister',
  'Mrs.': 'Missus',
  'Ms.': 'Miss',
  'Prof.': 'Professor',
  'St.': 'Saint',
  'Mt.': 'Mount',
  'Ft.': 'Fort',
  'No.': 'Number',
  'vs.': 'versus',
  'etc.': 'etcetera',
  'i.e.': 'that is',
  'e.g.': 'for example',
  'U.S.': 'United States',
  'U.K.': 'United Kingdom',
  'U.S.A.': 'United States of America',
}

function expandAbbrev(text: string): string {
  let out = text
  // 缩写映射按 key 长度倒序排，避免 "St." 在 "St." 与 "Street"（如果有）之间冲突
  const sorted = Object.entries(ABBREV_MAP).sort((a, b) => b[0].length - a[0].length)
  for (const [k, v] of sorted) {
    // 注意：缩写含 "."，词边界在标点旁不工作。改为：匹配 "<空格/开头>(key)" 即可。
    const re = new RegExp(`(^|\\s)${k.replace(/\./g, '\\.').replace(/\s/g, '\\s')}`, 'g')
    out = out.replace(re, (_, prefix) => prefix + v)
  }
  return out
}

/**
 * URL / 邮箱：直接剥成"网址"提示音，避免 TTS 把
 * "https://github.com/foo/bar" 念成一长串奇怪字符
 */
function maskUrlOrEmail(text: string): string {
  // 简易 URL
  const urlRe = /https?:\/\/[^\s一-龥]+/g
  let out = text.replace(urlRe, '网址链接')
  // 邮箱
  const emailRe = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
  out = out.replace(emailRe, '电子邮箱')
  return out
}

/**
 * 常见单位/数量（避免 5kg 读成 "K G"）
 *  - "5kg"   -> "五千克"
 *  - "100km" -> "一百千米"
 *  - "32°C"  -> "三十二摄氏度"
 */
const UNIT_TAILS = [
  // [英文单位, 中文读法]
  ['kg', '千克'],
  ['g', '克'],
  ['mg', '毫克'],
  ['km', '千米'],
  ['m', '米'],
  ['cm', '厘米'],
  ['mm', '毫米'],
  ['ml', '毫升'],
  ['L', '升'],
  ['°C', '摄氏度'],
  ['℃', '摄氏度'],
  ['°F', '华氏度'],
]

function numberWithUnitToCn(raw: string): string {
  // 简单匹配：数字 + 单位（紧贴、无空格）
  const re = new RegExp(`(-?\\d+(?:\\.\\d+)?)(${UNIT_TAILS.map(u => u[0].replace(/[°℃]/g, '\\$&')).join('|')})\\b`, 'g')
  return raw.replace(re, (_, num, unit) => {
    const mapped = UNIT_TAILS.find(u => u[0] === unit)?.[1] || unit
    return numberToCn(num) + mapped
  })
}

/**
 * 阿拉伯数字单独成串（且不在 URL/邮箱/百分号/货币/单位里）→ 中文读法
 * 兜底规则，比较保守：要求数字串前后是中文/空白/标点，且长度 1-16
 *
 * 保号语义：当原始串带前导零（如 "007"），逐位读（避免 TTS 读成 "七"）。
 */
function loneNumberToCn(raw: string): string {
  const re = /(?<![\w./@%-])(-?\d{1,16}(?:\.\d{1,8})?)(?![\w/%°℃A-Za-z])/g
  return raw.replace(re, (fullMatch) => {
    // 含前导零：按位读，"007" -> "零零七"
    if (/^-?0\d/.test(fullMatch)) {
      const sign = fullMatch.startsWith('-') ? '负' : ''
      const body = fullMatch.replace(/^-/, '')
      const [intP, decP] = body.split('.')
      let out = sign + intP.split('').map(d => CN_DIGITS[Number(d)]).join('')
      if (decP !== undefined) out += '点' + decP.split('').map(d => CN_DIGITS[Number(d)]).join('')
      return out
    }
    return numberToCn(fullMatch)
  })
}

/**
 * 主入口：把任意文本转成 TTS 友好文本
 * 处理顺序很重要：先剥 URL/邮箱（避免内部数字被误读），
 * 再百分比/货币/单位，再兜底数字，最后英文缩写。
 */
export function normalizeForTTS(text: string): string {
  if (!text || typeof text !== 'string') return text
  let s = text
  s = maskUrlOrEmail(s)
  s = percentToCn(s)
  // 百分号已替换；剩下的货币
  // 用一个不冲突的正则扫一遍
  s = s.replace(/[¥￥$€£]-?\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:元|美元|欧元|英镑|日元|块|毛)/g, (m) => currencyToCn(m))
  s = numberWithUnitToCn(s)
  s = loneNumberToCn(s)
  s = expandAbbrev(s)
  // 压缩多余空格，但保留标点
  s = s.replace(/[ \t]{2,}/g, ' ')
  return s
}