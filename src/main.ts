import { mount } from 'svelte'
// Archivo (all language) and Martian Mono (measured values and hardware IDs), self-hosted.
// The wdth builds carry both axes: headings use font-stretch 108 %, the mono 87.5 %.
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource-variable/martian-mono/wdth.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/instrument.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
