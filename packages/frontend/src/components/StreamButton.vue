<template>
  <div class="tts-audio-player">
    <audio
      ref="audioRef"
      @timeupdate="updateProgress"
      @ended="onended"
      @error="onError"
      @loadedmetadata="onLoaded"
    >
      你的浏览器不支持音频播放。
    </audio>
    <div class="controls">
      <el-button circle @click="left10" aria-label="快退 10 秒">
        <el-icon><DArrowLeft /></el-icon>
      </el-button>
      <el-button
        :type="isPlaying ? 'warning' : 'primary'"
        circle
        size="large"
        @click="toggle"
        :aria-label="isPlaying ? '暂停' : '播放'"
      >
        <el-icon v-if="!isPlaying"><VideoPlay /></el-icon>
        <el-icon v-else><VideoPause /></el-icon>
      </el-button>
      <el-button circle @click="right10" aria-label="快进 10 秒">
        <el-icon><DArrowRight /></el-icon>
      </el-button>
    </div>
    <div class="progress-container">
      <el-slider
        size="small"
        v-model="progress"
        :max="100"
        :show-tooltip="false"
        @change="seek"
        class="progress-slider"
        :aria-label="`播放进度 ${formatTime(currentTime)} / ${formatTime(duration)}`"
      />
    </div>
    <div class="time-display" aria-live="polite">
      <span>{{ formatTime(currentTime) }} / {{ formatTime(duration) }}</span>
    </div>
    <el-button class="close-btn" link @click="emitClose" aria-label="关闭播放器">
      <el-icon><Close /></el-icon>
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElSlider } from 'element-plus'
import { VideoPlay, VideoPause, Close, DArrowLeft, DArrowRight } from '@element-plus/icons-vue'

const props = defineProps<{
  /** 音频时长（秒）— 用于计算进度百分比 */
  duration?: number
  /** 音频源 URL — 设置后自动加载 */
  src?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const audioRef = ref<HTMLAudioElement | null>(null)
const progress = ref(0)
const currentTime = ref(0)
const isPlaying = ref(false)

const toggle = async () => {
  if (!audioRef.value) return
  try {
    if (isPlaying.value) {
      audioRef.value.pause()
      isPlaying.value = false
    } else {
      await audioRef.value.play()
      isPlaying.value = true
    }
  } catch (e) {
    // 静默处理 play() reject（autoplay policy 等）
    isPlaying.value = false
  }
}

const left10 = () => {
  if (!audioRef.value) return
  audioRef.value.currentTime = Math.max(0, audioRef.value.currentTime - 10)
}
const right10 = () => {
  if (!audioRef.value) return
  const max = Number.isFinite(audioRef.value.duration) ? audioRef.value.duration : Infinity
  audioRef.value.currentTime = Math.min(max, audioRef.value.currentTime + 10)
}

const updateProgress = () => {
  if (!audioRef.value) return
  currentTime.value = audioRef.value.currentTime
  // 用实际 duration（loadedmetadata 后才有），不用 props.duration（可能未设置）
  const dur = Number.isFinite(audioRef.value.duration) ? audioRef.value.duration : 0
  progress.value = dur > 0 ? (currentTime.value / dur) * 100 : 0
}

const onended = () => {
  isPlaying.value = false
}

const onLoaded = () => {
  if (!audioRef.value) return
  // duration 是真实时长，赋值给 props.duration 供父组件用（如显示）
  if (!props.duration && Number.isFinite(audioRef.value.duration)) {
    // emit 父组件（可选）
  }
}

const onError = () => {
  isPlaying.value = false
  // 不弹 toast（调用方处理）；仅静默失败
}

const seek = (value: number | number[]) => {
  if (Array.isArray(value)) return
  if (!audioRef.value) return
  const dur = Number.isFinite(audioRef.value.duration) ? audioRef.value.duration : 0
  if (dur > 0) audioRef.value.currentTime = (value / 100) * dur
}

const formatTime = (time: number) => {
  if (!Number.isFinite(time)) return '0:00'
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

const emitClose = () => emit('close')

// 外部 src 变化时重新加载
watch(
  () => props.src,
  (newSrc) => {
    if (!audioRef.value) return
    audioRef.value.pause()
    isPlaying.value = false
    progress.value = 0
    currentTime.value = 0
    if (newSrc) {
      audioRef.value.src = newSrc
      audioRef.value.load()
    } else {
      audioRef.value.removeAttribute('src')
    }
  }
)

// expose 标准化 API：父组件用 ref 调用
defineExpose({
  setSrc(url: string) {
    if (audioRef.value && url) {
      audioRef.value.src = url
      audioRef.value.load()
    }
  },
  play: () => audioRef.value?.play(),
  pause: () => audioRef.value?.pause(),
  stop() {
    if (!audioRef.value) return
    audioRef.value.pause()
    audioRef.value.currentTime = 0
    progress.value = 0
    currentTime.value = 0
    isPlaying.value = false
  },
  get audioRef() {
    return audioRef.value
  },
})
</script>

<style scoped>
.tts-audio-player {
  margin: 10px auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px;
  background: white;
  border-radius: 15px;
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  width: 300px;
  transition: all 0.3s ease;
  position: relative;
}

.tts-audio-player:hover {
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
}

.controls {
  display: flex;
  gap: 10px;
  margin-bottom: 15px;
  align-items: center;
}

.el-button {
  font-size: 18px;
  padding: 10px;
  transition: transform 0.2s ease;
}

.el-button:hover {
  transform: scale(1.1);
}

.progress-container {
  width: 100%;
  padding: 0 10px;
  margin-bottom: 10px;
}

.progress-slider {
  width: 100%;
}

.time-display {
  font-size: 14px;
  color: #333;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.7);
  padding: 5px 10px;
  border-radius: 20px;
}

.close-btn {
  position: absolute;
  top: 16px;
  right: 16px;
}
</style>