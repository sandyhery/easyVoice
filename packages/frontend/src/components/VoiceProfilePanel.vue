<template>
  <div class="voice-profile-panel">
    <div class="profile-header">
      <span class="label">声音预设</span>
      <el-button
        link
        type="primary"
        @click="loadProfiles"
        :icon="Refresh"
        circle
        aria-label="刷新预设列表"
      />
    </div>

    <div class="profile-row">
      <el-select
        v-model="selectedId"
        placeholder="选择已保存的预设"
        clearable
        filterable
        @change="onSelect"
        style="flex: 1"
      >
        <el-option
          v-for="p in profiles"
          :key="p.id"
          :label="p.name"
          :value="p.id"
        >
          <div class="profile-option">
            <span class="profile-name">{{ p.name }}</span>
            <span class="profile-voice">{{ p.voice }}</span>
            <el-button
              link
              type="danger"
              :icon="Delete"
              size="small"
              class="profile-delete"
              @click.stop="onDeleteClick(p.id, $event)"
            />
          </div>
        </el-option>
      </el-select>
      <el-button type="primary" plain :icon="Plus" @click="openSaveDialog">保存当前</el-button>
    </div>

    <el-dialog v-model="dialogVisible" title="保存声音预设" width="420px">
      <el-form label-position="top">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="例如：徐凤年 - 剑客" maxlength="32" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="form.description"
            type="textarea"
            :rows="2"
            placeholder="可选：场景 / 性格等"
          />
        </el-form-item>
        <el-form-item label="参数预览">
          <div class="param-preview">
            <div>voice: {{ form.voice || '(未选择)' }}</div>
            <div>rate: {{ form.rate || '+0%' }}</div>
            <div>pitch: {{ form.pitch || '+0Hz' }}</div>
            <div>volume: {{ form.volume || '+0%' }}</div>
            <div>engine: {{ form.engine || 'edge-tts' }}</div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveProfile" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Plus, Delete } from '@element-plus/icons-vue'
import {
  listProfiles,
  createProfile,
  deleteProfile,
  type VoiceProfile,
} from '@/api/tts'

const props = defineProps<{
  voice: string
  rate: string
  pitch: string
  volume: string
  engine?: string
}>()

const emit = defineEmits<{
  (e: 'apply', p: VoiceProfile): void
}>()

const profiles = ref<VoiceProfile[]>([])
const selectedId = ref<string>('')
const dialogVisible = ref(false)
const saving = ref(false)

const form = reactive({
  name: '',
  description: '',
  voice: '',
  rate: '',
  pitch: '',
  volume: '',
  engine: '',
})

const loadProfiles = async () => {
  try {
    const res = await listProfiles()
    if (res.code === 200 && res.data) {
      profiles.value = res.data
    }
  } catch (e) {
    ElMessage.error(`加载预设失败: ${(e as Error).message}`)
  }
}

const onSelect = async (id: string) => {
  if (!id) return
  const p = profiles.value.find((x) => x.id === id)
  if (p) emit('apply', p)
}

const onDeleteClick = async (id: string, e: Event) => {
  e.stopPropagation()
  await removeProfile(id)
}

const openSaveDialog = () => {
  if (!props.voice) {
    ElMessage.warning('请先选择一个语音')
    return
  }
  form.name = ''
  form.description = ''
  form.voice = props.voice
  form.rate = props.rate
  form.pitch = props.pitch
  form.volume = props.volume
  form.engine = props.engine || 'edge-tts'
  dialogVisible.value = true
}

const saveProfile = async () => {
  if (!form.name.trim()) {
    ElMessage.warning('请填写预设名称')
    return
  }
  saving.value = true
  try {
    const res = await createProfile({
      name: form.name.trim(),
      description: form.description || undefined,
      voice: form.voice,
      rate: form.rate,
      pitch: form.pitch,
      volume: form.volume,
      engine: form.engine,
    })
    if (res.code === 200 && res.data) {
      ElMessage.success('已保存')
      dialogVisible.value = false
      await loadProfiles()
      selectedId.value = res.data.id
    } else {
      ElMessage.error(res.message || '保存失败')
    }
  } catch (e) {
    ElMessage.error(`保存失败: ${(e as Error).message}`)
  } finally {
    saving.value = false
  }
}

const removeProfile = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定删除该预设？', '提示', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteProfile(id)
    ElMessage.success('已删除')
    await loadProfiles()
    if (selectedId.value === id) selectedId.value = ''
  } catch (e) {
    ElMessage.error(`删除失败: ${(e as Error).message}`)
  }
}

defineExpose({ removeProfile, loadProfiles })

// 联动：父组件修改 audioConfig.selectedVoice 后，自动反选匹配的预设
watch(
  () => props.voice,
  (v) => {
    if (!v || !profiles.value.length) return
    const match = profiles.value.find((p) => p.voice === v)
    if (match && selectedId.value !== match.id) {
      selectedId.value = match.id
    } else if (!match && selectedId.value) {
      selectedId.value = ''
    }
  }
)

onMounted(loadProfiles)
</script>

<style scoped>
.voice-profile-panel {
  border-top: 1px dashed var(--el-border-color);
  padding-top: 12px;
  margin-top: 8px;
}
.profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.profile-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.profile-option {
  display: flex;
  flex-direction: column;
  position: relative;
}
.profile-delete {
  position: absolute;
  right: 0;
  top: 0;
  opacity: 0;
  transition: opacity 0.2s;
}
.profile-option:hover .profile-delete {
  opacity: 1;
}
.profile-name {
  font-size: 14px;
  color: var(--el-text-color-primary);
}
.profile-voice {
  font-size: 11px;
  color: var(--el-text-color-secondary);
}
.param-preview {
  font-size: 12px;
  color: var(--el-text-color-regular);
  background: var(--el-fill-color-light);
  padding: 8px 10px;
  border-radius: 4px;
  line-height: 1.6;
}
</style>