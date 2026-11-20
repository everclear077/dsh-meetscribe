export type CaptureSource = 'microphone' | 'system' | 'mixed'

const releases = new WeakMap<MediaStream, () => Promise<void>>()

const microphone = (): Promise<MediaStream> => navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: false,
  },
})

/**
 * Acquire meeting audio. System capture uses Chromium's share picker: on Windows,
 * sharing a screen normally includes system audio, while a single window may not.
 */
export async function acquireMeetingAudio(source: CaptureSource): Promise<MediaStream> {
  let mic: MediaStream | null = null
  let display: MediaStream | null = null
  try {
    if (source !== 'system') mic = await microphone()
    if (source !== 'microphone') {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      if (display.getAudioTracks().length === 0) throw new Error('所选共享内容没有系统音频，请重新选择“整个屏幕”并开启“共享音频”')
    }
    if (source === 'microphone') return mic!
    const originals = [mic, display].filter((item): item is MediaStream => item !== null)
    const context = new AudioContext()
    const destination = context.createMediaStreamDestination()
    for (const input of originals) {
      if (input.getAudioTracks().length > 0) context.createMediaStreamSource(input).connect(destination)
    }
    const stream = new MediaStream(destination.stream.getAudioTracks())
    let released = false
    const release = async (): Promise<void> => {
      if (released) return
      released = true
      for (const input of originals) input.getTracks().forEach((track) => track.stop())
      stream.getTracks().forEach((track) => track.stop())
      await context.close().catch(() => undefined)
    }
    releases.set(stream, release)
    display!.getVideoTracks().forEach((track) => track.addEventListener('ended', () => { void release() }, { once: true }))
    return stream
  } catch (error) {
    mic?.getTracks().forEach((track) => track.stop())
    display?.getTracks().forEach((track) => track.stop())
    if (source !== 'microphone' && error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('DeepSeek Harness 未授予屏幕与系统音频权限。当前版本请改用麦克风；若已开放共享选择器，请选择“整个屏幕”并开启“共享音频”。')
    }
    throw error
  }
}

export async function releaseMeetingAudio(stream: MediaStream): Promise<void> {
  await releases.get(stream)?.()
}
