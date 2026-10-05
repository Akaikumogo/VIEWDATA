const { rmSync } = require('node:fs')
const { join } = require('node:path')

// WebGPU shader compiler and the SwiftShader Vulkan fallback. The UI is DOM/SVG only,
// so neither is ever loaded, and together they add ~10 MB to the installer.
const UNUSED = ['dxcompiler.dll', 'dxil.dll', 'vk_swiftshader.dll', 'vk_swiftshader_icd.json']

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  for (const file of UNUSED) rmSync(join(context.appOutDir, file), { force: true })
}
