import { SpeakerIdentifier } from '../lib/index.js'
import { join } from 'node:path'
const modelRoot = join(process.env.LOCALAPPDATA, 'dsh-meetscribe', 'models')
const identifier = new SpeakerIdentifier(join(modelRoot, 'speaker'), () => {})
const samples = new Float32Array(16000 * 2)
for (let i = 0; i < samples.length; i++) samples[i] = Math.sin(i / 20) * 0.1
console.log(await identifier.identify('native-smoke', samples, 0.62, 8))
