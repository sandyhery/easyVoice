import { detectChapters, splitTextWithChapters } from '../src/services/text.service'

describe('detectChapters', () => {
  test('识别中文"第X章"', () => {
    const text = `第一章 开篇
这是第一章的正文。

第二章 发展
这是第二章的正文。`
    const chapters = detectChapters(text)
    expect(chapters.length).toBe(2)
    expect(chapters[0].index).toBe(1)
    expect(chapters[0].title).toContain('第一章')
    expect(chapters[1].index).toBe(2)
  })

  test('识别"第X卷"', () => {
    const text = `第一卷 风起
正文内容

第二卷 云涌
更多内容`
    const chapters = detectChapters(text)
    expect(chapters.length).toBe(2)
    expect(chapters[0].title).toContain('第一卷')
  })

  test('识别英文 Chapter X', () => {
    const text = `Chapter 1: The Beginning
Once upon a time

CHAPTER 2
The journey continues`
    const chapters = detectChapters(text)
    expect(chapters.length).toBe(2)
  })

  test('无章节时不识别', () => {
    const text = '这是普通文本。没有章节标题。只是一段连续的内容。'
    expect(detectChapters(text).length).toBe(0)
  })
})

describe('splitTextWithChapters', () => {
  test('带章节的文本被切分且标注 chapterIndex', () => {
    const text = `第一章 开篇
${'这是第一章的正文内容。'.repeat(20)}

第二章 发展
${'这是第二章的正文内容。'.repeat(20)}`
    const result = splitTextWithChapters(text, 200, { normalize: false })
    expect(result.chapterCount).toBe(2)
    expect(result.segments.length).toBeGreaterThan(0)
    // 第一章节的 segment 应该有 chapterIndex=1
    const ch1Segments = result.segments.filter((s) => s.chapterIndex === 1)
    const ch2Segments = result.segments.filter((s) => s.chapterIndex === 2)
    expect(ch1Segments.length).toBeGreaterThan(0)
    expect(ch2Segments.length).toBeGreaterThan(0)
  })

  test('无章节文本退回 chapterIndex=0', () => {
    const text = '普通文本没有章节标题。'.repeat(50)
    const result = splitTextWithChapters(text, 100, { normalize: false })
    expect(result.chapterCount).toBe(0)
    expect(result.segments.every((s) => s.chapterIndex === 0)).toBe(true)
  })
})
