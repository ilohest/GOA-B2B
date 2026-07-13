import { computed, ref, shallowRef } from 'vue'

type HeaderSaveBarAction = () => void | Promise<void>

type HeaderSaveBarState = {
  label: string
  pending?: boolean
  onDiscard: HeaderSaveBarAction
  onSave: HeaderSaveBarAction
}

const state = shallowRef<HeaderSaveBarState | null>(null)
const shakeTick = ref(0)

export function useHeaderSaveBar() {
  return {
    saveBar: computed(() => state.value),
    shakeTick: computed(() => shakeTick.value),
    setSaveBar(next: HeaderSaveBarState | null) {
      state.value = next
    },
    clearSaveBar() {
      state.value = null
    },
    triggerSaveBarShake() {
      shakeTick.value += 1
    },
  }
}
