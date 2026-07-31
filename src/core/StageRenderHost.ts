import {
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from 'three'
import type { QualityProfile } from './types.js'
import type { MotionRendererFactoryContext } from '../renderers/MotionRenderer.js'

export class StageRenderHost {
  readonly scene = new Scene()
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  readonly contentRoot = new Group()
  readonly canvas: HTMLCanvasElement
  private readonly abortController = new AbortController()
  private readonly initialAntialias: boolean
  private disposed = false
  private environmentSnapshot: ReturnType<StageRenderHost['createEnvironmentSnapshot']> | null = null

  constructor(
    private readonly container: HTMLElement,
    profile: QualityProfile,
    cameraZ = 18,
  ) {
    this.initialAntialias = profile.antialias
    this.camera = new PerspectiveCamera(45, 1, 0.1, 100)
    this.camera.position.z = cameraZ
    this.renderer = new WebGLRenderer({
      alpha: true,
      antialias: profile.antialias,
      powerPreference: 'high-performance',
    })
    this.canvas = this.renderer.domElement
    try {
      this.setPixelRatio(profile.maxPixelRatio)
      this.canvas.style.width = this.canvas.style.height = '100%'
      this.container.appendChild(this.canvas)
      this.contentRoot.name = 'SpatialMotionContent'
      this.scene.add(this.contentRoot)
    } catch (error) {
      this.renderer.dispose()
      this.canvas.remove()
      throw error
    }
  }

  createRendererFactoryContext(): MotionRendererFactoryContext {
    const context = this.renderer.getContext()
    return {
      root: this.contentRoot,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      maxTextureLayers: resolveMaxTextureLayers(context),
      maxAnisotropy: this.renderer.capabilities.getMaxAnisotropy(),
      signal: this.abortController.signal,
      prepareTexture: (texture) => {
        const startedAt = performance.now()
        this.renderer.initTexture(texture)
        return performance.now() - startedAt
      },
      prepareProgram: async (material, geometry) => {
        const startedAt = performance.now()
        const scene = new Scene()
        scene.add(new Mesh(geometry, material))
        if (typeof this.renderer.compileAsync === 'function') {
          await this.renderer.compileAsync(scene, this.camera)
        } else {
          this.renderer.compile(scene, this.camera)
        }
        return performance.now() - startedAt
      },
    }
  }

  resize(width = this.container.clientWidth, height = this.container.clientHeight): void {
    this.environmentSnapshot = null
    const safeHeight = Math.max(1, height)
    this.camera.aspect = width / safeHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  setPixelRatio(maxPixelRatio: number): void {
    this.environmentSnapshot = null
    const ratio = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1
    this.renderer.setPixelRatio(Math.min(ratio, maxPixelRatio))
  }

  render(): void {
    this.renderer.render(this.scene, this.camera)
  }

  restoreBaseState(): void {
    this.resize()
  }

  getViewport(): { width: number; height: number; pixelRatio: number } {
    return {
      width: this.container.clientWidth,
      height: this.container.clientHeight,
      pixelRatio: this.renderer.getPixelRatio(),
    }
  }

  getVisibleWorldSize(): { width: number; height: number } {
    const viewport = this.getViewport()
    const distance = Math.abs(this.camera.position.z)
    const height = 2 * Math.tan(this.camera.fov * Math.PI / 360) * distance
    return {
      width: height * (viewport.width / Math.max(1, viewport.height)),
      height,
    }
  }

  getRenderStats(): { drawCalls: number; triangles: number } {
    return {
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    }
  }

  getEnvironment(): {
    userAgent: string
    platform: string
    logicalCores: number | null
    deviceMemoryGb: number | null
    viewportWidth: number
    viewportHeight: number
    devicePixelRatio: number
    pixelRatio: number
    maxTextureSize: number
    webglVersion: string
    antialias: boolean
    gpuVendor: string | null
    gpuRenderer: string | null
  } {
    return this.environmentSnapshot ??= this.createEnvironmentSnapshot()
  }

  private createEnvironmentSnapshot(): {
    userAgent: string
    platform: string
    logicalCores: number | null
    deviceMemoryGb: number | null
    viewportWidth: number
    viewportHeight: number
    devicePixelRatio: number
    pixelRatio: number
    maxTextureSize: number
    webglVersion: string
    antialias: boolean
    gpuVendor: string | null
    gpuRenderer: string | null
  } {
    const context = this.renderer.getContext()
    const debugInfo = context.getExtension('WEBGL_debug_renderer_info') as {
      UNMASKED_VENDOR_WEBGL: number
      UNMASKED_RENDERER_WEBGL: number
    } | null
    const browserNavigator = typeof navigator === 'undefined'
      ? null
      : navigator as Navigator & { deviceMemory?: number }
    const viewport = this.getViewport()
    return Object.freeze({
      userAgent: browserNavigator?.userAgent ?? '',
      platform: browserNavigator?.platform ?? '',
      logicalCores: finiteOrNull(browserNavigator?.hardwareConcurrency),
      deviceMemoryGb: finiteOrNull(browserNavigator?.deviceMemory),
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
      pixelRatio: viewport.pixelRatio,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      webglVersion: String(context.getParameter(context.VERSION) ?? ''),
      antialias: typeof context.getContextAttributes === 'function'
        ? Boolean(context.getContextAttributes()?.antialias)
        : this.initialAntialias,
      gpuVendor: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) ?? '') : null,
      gpuRenderer: debugInfo ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? '') : null,
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.abortController.abort()
    disposeObjectResources(this.contentRoot)
    this.scene.remove(this.contentRoot)
    this.renderer.dispose()
    this.canvas.remove()
  }
}

function finiteOrNull(value: number | undefined): number | null {
  return Number.isFinite(value) ? value ?? null : null
}

function resolveMaxTextureLayers(
  context: WebGLRenderingContext | WebGL2RenderingContext,
): number {
  const parameter = (context as WebGL2RenderingContext).MAX_ARRAY_TEXTURE_LAYERS
  if (!Number.isFinite(parameter)) return 256
  const value = context.getParameter(parameter)
  return Number.isFinite(value) ? Math.max(1, Math.floor(value as number)) : 256
}

function disposeObjectResources(root: Object3D): void {
  const geometries = new Set<{ dispose(): void }>()
  const materials = new Set<Material>()
  const textures = new Set<Texture>()
  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: { dispose(): void }
      material?: Material | Material[]
    }
    if (renderable.geometry?.dispose) geometries.add(renderable.geometry)
    const objectMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material ? [renderable.material] : []
    objectMaterials.forEach((material) => {
      materials.add(material)
      Object.values(material).forEach((value) => {
        if (value && typeof value === 'object' && (value as Texture).isTexture) {
          textures.add(value as Texture)
        }
      })
    })
  })
  textures.forEach((texture) => texture.dispose())
  materials.forEach((material) => material.dispose())
  geometries.forEach((geometry) => geometry.dispose())
}
