var YTAmbilight = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/ambilight.js
  var ambilight_exports = {};
  __export(ambilight_exports, {
    Ambilight: () => Ambilight,
    extensionDefaults: () => extensionDefaults,
    followVideoFrames: () => followVideoFrames
  });

  // src/errors/sentry-reporter.js
  var SentryReporter = class {
    static captureException(ex) {
      console.warn("ambient light:", ex);
    }
  };

  // src/errors/ambient-light-error.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/errors/ambient-light-error.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var AmbientlightError = class extends Error {
    constructor(message, details) {
      super(message);
      this.details = details;
    }
  };

  // src/generic.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/generic.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var errorHandler = (ex) => {
    console.error(ex);
  };
  var setErrorHandler = (handler) => {
    errorHandler = handler;
  };
  var displayErrorHandler;
  var wrapErrorHandlerHandleError = (stack, ex, reportOnce, reported) => {
    if (reportOnce) {
      if (reported.includes(ex.message)) return;
      reported.push(ex.message);
    }
    appendErrorStack(stack, ex);
    if (errorHandler) errorHandler(ex);
    if (displayErrorHandler) displayErrorHandler(ex);
  };
  var withErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || "anonymous";
    const container = {
      [callbackName]: (...args) => {
        try {
          return callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      }
    };
    return container[callbackName];
  };
  var withAsyncErrorHandler = (callback, reportOnce, stack, reported) => {
    const callbackName = callback.name || "anonymous";
    const container = {
      [callbackName]: async (...args) => {
        try {
          return await callback(...args);
        } catch (ex) {
          wrapErrorHandlerHandleError(stack, ex, reportOnce, reported);
        }
      }
    };
    return container[callbackName];
  };
  var wrapErrorHandler = (callback, reportOnce = false) => (callback.constructor.name === "AsyncFunction" ? withAsyncErrorHandler : withErrorHandler)(callback, reportOnce, new Error().stack, []);
  var eventListenerCallbacks = [];
  function on(elem, eventNames, callback, options, reportOnce = false) {
    try {
      const stack = new Error().stack;
      const callbacksName = `on_${eventNames.split(" ").join("_")}`;
      let reported = [];
      const namedCallbacks = {
        [callbacksName]: async (...args) => {
          try {
            await callback(...args);
          } catch (ex) {
            if (reportOnce) {
              if (reported.includes(ex.message)) return;
              reported.push(ex.message);
            }
            const e = args.length ? args[0] : {};
            const type = e.type === "keydown" ? `${e.type} keyCode: ${e.keyCode}` : e.type;
            ex.message = `${ex.message} 
On event: ${type}`;
            try {
              if (elem) {
                ex.message = `${ex.message} 
Elem: ${elem.toString()} ${elem.nodeName || ""}#${elem.id || ""}.${elem.className || ""}`;
              }
            } catch (elemEx) {
              ex.details = {
                ...ex.details || {},
                elemEx
              };
            }
            try {
              if (e?.target) {
                ex.message = `${ex.message} 
Target: ${e.target.toString()} ${e.target.nodeName || ""}#${e.target.id || ""}.${e.target.className || ""}`;
              }
            } catch (targetEx) {
              ex.details = {
                ...ex.details || {},
                targetEx
              };
            }
            try {
              if (e?.currentTarget) {
                ex.message = `${ex.message} 
CurrentTarget: ${e.currentTarget.toString()} ${e.currentTarget.nodeName || ""}#${e.currentTarget.id || ""}.${e.currentTarget.className || ""}`;
              }
            } catch (currentTargetEx) {
              ex.details = {
                ...ex.details || {},
                currentTargetEx
              };
            }
            ex.details = {
              ...ex.details || {},
              eventNames,
              options,
              reportOnce
            };
            appendErrorStack(stack, ex);
            if (errorHandler) errorHandler(ex);
          }
        }
      };
      const eventListenerCallback = namedCallbacks[callbacksName];
      const eventNamesList = eventNames.split(" ");
      const existingEventListenerCallback = eventListenerCallbacks.find(
        (e) => e.args.elem === elem && e.args.callback === callback && JSON.stringify(e.args.options) === JSON.stringify(options)
      );
      for (const eventName of eventNamesList) {
        if (existingEventListenerCallback) {
          if (existingEventListenerCallback.args.eventNamesList.includes(eventName)) {
            continue;
          } else {
            existingEventListenerCallback.args.eventNamesList.push(eventName);
          }
        }
        elem.addEventListener(eventName, eventListenerCallback, options);
      }
      if (!existingEventListenerCallback) {
        eventListenerCallbacks.push({
          args: {
            elem,
            eventNamesList,
            callback,
            options
          },
          callback: eventListenerCallback
        });
      }
    } catch (ex) {
      ex.details = {
        eventNames,
        options,
        reportOnce
      };
      try {
        if (elem) {
          ex.message = `${ex.message} 
For element: ${elem.toString()} ${elem.nodeName || ""}#${elem.id || ""}.${elem.className || ""}`;
        }
      } catch (elemEx) {
        ex.details = {
          ...ex.details || {},
          elemEx
        };
      }
      console.log("catched", ex);
      throw ex;
    }
  }
  var raf = (callback) => requestAnimationFrame(wrapErrorHandler(callback));
  var colorSpace = (
    // rec2020 in canvas is not yet supported
    // globalThis.matchMedia('(color-gamut: rec2020)').matches
    //   ? 'rec2020'
    //   : (
    globalThis.matchMedia("(color-gamut: p3)").matches ? "display-p3" : "srgb"
  );
  var extendedColorSpace = (
    // rec2020 in canvas is not yet supported
    globalThis.matchMedia("(color-gamut: rec2020)").matches ? "rec2020" : globalThis.matchMedia("(color-gamut: p3)").matches ? "display-p3" : "srgb"
  );
  var ctxOptions = {
    // alpha: false, // Decreases performance on some platforms
    // desynchronized: true,
    imageSmoothingQuality: "low",
    colorSpace,
    extendedColorSpace
  };
  var Canvas = class {
    constructor(width, height, pixelated) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      if (pixelated) {
        canvas.style.imageRendering = "pixelated";
      }
      return canvas;
    }
  };
  var SafeOffscreenCanvas = class {
    constructor(width, height, pixelated) {
      if (typeof OffscreenCanvas !== "undefined") {
        return new OffscreenCanvas(width, height);
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        if (pixelated) {
          canvas.style.imageRendering = "pixelated";
        }
        return canvas;
      }
    }
  };
  function requestIdleCallback(callback, options, reportOnce = false) {
    return globalThis.requestIdleCallback ? globalThis.requestIdleCallback(
      wrapErrorHandler(callback, reportOnce),
      options
    ) : globalThis.setTimeout(wrapErrorHandler(callback, reportOnce), 1);
  }
  var appendErrorStack = (stack, ex) => {
    try {
      const stackToAppend = stack?.substring(stack?.indexOf("\n") + 1);
      const stackToSearch = stackToAppend?.substring(
        stackToAppend?.indexOf("\n") + 1
      );
      const alreadyContainsStack = (ex?.stack || ex?.message || ex?.toString())?.indexOf(stackToSearch) !== -1;
      if (!alreadyContainsStack) {
        ex.stack = `${ex.stack || ex.message || ex.toString()}
${stackToAppend}`;
      }
    } catch (ex2) {
      console.warn(ex2);
    }
  };
  var webGLErrorToString = (value) => ({
    1280: "GL_INVALID_ENUM",
    1281: "GL_INVALID_VALUE",
    1282: "GL_INVALID_OPERATION",
    1285: "GL_OUT_OF_MEMORY",
    1286: "GL_INVALID_FRAMEBUFFER_OPERATION",
    1287: "GL_CONTEXT_LOST_WEBGL"
  }[value] || value) ?? "UNKNOWN";
  var setStyleProperty = (elem, name, value, priority = "") => {
    const currentValue = elem.style.getPropertyValue(name) ?? "";
    const currentPriority = elem.style.getPropertyPriority(name) ?? "";
    if (currentValue === value && currentPriority === priority) return;
    elem.style.setProperty(name, value, priority);
  };
  var canvas2DCrashTips = `

Reload the webpage to try it again.

Possible causes:
- The memory of your GPU is fully used by another application.
- You have to many YouTube webpages visible at the same time. You GPU can only render a limit amount of ambient lights at the same time.
- You have changed a setting to a value that is incompatible with your GPU. Undo your last change and refresh the webpage. Or reset all settings with the reset button at the top right.`;
  var canvasWebGLCrashTips = `${canvas2DCrashTips}

Another possible workaround could be to turn off the "Quality" > "WebGL renderer" setting (This is an advanced setting). But if you do so, know that the legacy renderer requires more power.`;

  // src/projector-shadow.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/projector-shadow.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var WIDTH = 512;
  var HEIGHT = 512;
  var ProjectorShadow = class {
    constructor(offscreen = true) {
      this.elem = offscreen ? new SafeOffscreenCanvas(512, 512, true) : new Canvas(512, 512);
      this.ctx = this.elem.getContext("2d", { ...ctxOptions, alpha: true });
    }
    rescale(scale, projectorSize, settings) {
      if (this.elem.style) {
        this.elem.style.transform = `scale(${scale.x + 0.01}, ${scale.y + 0.01})`;
      }
      const {
        spreadFadeCurve,
        spreadFadeStart,
        directionTopEnabled,
        directionRightEnabled,
        directionBottomEnabled,
        directionLeftEnabled
      } = settings;
      const cacheKey = JSON.stringify({
        scale,
        projectorSize,
        spreadFadeCurve,
        spreadFadeStart,
        directionTopEnabled,
        directionRightEnabled,
        directionBottomEnabled,
        directionLeftEnabled
      });
      if (this.elem.width !== WIDTH || this.elem.height !== HEIGHT) {
        this.elem.width = WIDTH;
        this.elem.height = HEIGHT;
      } else if (this.cacheKey !== cacheKey) {
        this.ctx.clearRect(0, 0, WIDTH, HEIGHT);
      } else {
        return;
      }
      const edge = {
        w: (projectorSize.w * scale.x - projectorSize.w) / 2 / scale.x,
        h: (projectorSize.h * scale.y - projectorSize.h) / 2 / scale.y
      };
      const video = {
        w: projectorSize.w / scale.x,
        h: projectorSize.h / scale.y
      };
      const darkest = 1;
      const easing = 16 / (spreadFadeCurve * 0.64);
      const keyframes = this.plotKeyframes(256, easing, darkest);
      let fadeOutFrom = spreadFadeStart / 100;
      const fadeOutMinH = -(video.h / 2 / edge.h);
      const fadeOutMinW = -(video.w / 2 / edge.w);
      fadeOutFrom = Math.max(fadeOutFrom, fadeOutMinH, fadeOutMinW);
      try {
        this.drawGradient(
          video.h,
          edge.h,
          keyframes,
          fadeOutFrom,
          darkest,
          false
        );
        this.drawGradient(video.w, edge.w, keyframes, fadeOutFrom, darkest, true);
      } catch (ex) {
        ex.details = {
          ...ex.details,
          scale: { ...scale },
          projectorSize: { ...projectorSize },
          easing
        };
        throw ex;
      }
      const scaleW = WIDTH / (video.w + edge.w + edge.w);
      const scaleH = HEIGHT / (video.h + edge.h + edge.h);
      this.ctx.fillStyle = "#000000";
      if (!directionTopEnabled) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(scaleW * edge.w, scaleH * edge.h);
        this.ctx.lineTo(
          scaleW * (edge.w + video.w / 2),
          scaleH * (edge.h + video.h / 2)
        );
        this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * edge.h);
        this.ctx.lineTo(scaleW * (edge.w + video.w + edge.w), 0);
        this.ctx.fill();
      }
      if (!directionRightEnabled) {
        this.ctx.beginPath();
        this.ctx.lineTo(scaleW * (edge.w + video.w + edge.w), 0);
        this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * edge.h);
        this.ctx.lineTo(
          scaleW * (edge.w + video.w / 2),
          scaleH * (edge.h + video.h / 2)
        );
        this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * (edge.h + video.h));
        this.ctx.lineTo(
          scaleW * (edge.w + video.w + edge.w),
          scaleH * (edge.h + video.h + edge.h)
        );
        this.ctx.fill();
      }
      if (!directionBottomEnabled) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, scaleH * (edge.h + video.h + edge.h));
        this.ctx.lineTo(scaleW * edge.w, scaleH * (edge.h + video.h));
        this.ctx.lineTo(
          scaleW * (edge.w + video.w / 2),
          scaleH * (edge.h + video.h / 2)
        );
        this.ctx.lineTo(scaleW * (edge.w + video.w), scaleH * (edge.h + video.h));
        this.ctx.lineTo(
          scaleW * (edge.w + video.w + edge.w),
          scaleH * (edge.h + video.h + edge.h)
        );
        this.ctx.fill();
      }
      if (!directionLeftEnabled) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, 0);
        this.ctx.lineTo(scaleW * edge.w, scaleH * edge.h);
        this.ctx.lineTo(
          scaleW * (edge.w + video.w / 2),
          scaleH * (edge.h + video.h / 2)
        );
        this.ctx.lineTo(scaleW * edge.w, scaleH * (edge.h + video.h));
        this.ctx.lineTo(0, scaleH * (edge.h + video.h + edge.h));
        this.ctx.fill();
      }
      this.cacheKey = cacheKey;
    }
    plotKeyframes = (length, powerOf, darkest) => {
      const keyframes = [];
      for (let i = 1; i < length; i++) {
        keyframes.push({
          p: i / length,
          o: Math.pow(i / length, powerOf) * darkest
        });
      }
      return keyframes.map(({ p, o }) => ({
        p: Math.round(p * 1e4) / 1e4,
        o: Math.round(o * 1e4) / 1e4
      }));
    };
    //Shadow gradient
    drawGradient = (...args) => {
      const [size, edge, keyframes, fadeOutFrom, darkest, horizontal] = args;
      const points = [
        0,
        ...keyframes.map(
          (e) => Math.max(0, edge - edge * e.p - edge * fadeOutFrom * (1 - e.p))
        ),
        edge - edge * fadeOutFrom,
        edge + size + edge * fadeOutFrom,
        ...keyframes.reverse().map(
          (e) => Math.min(
            edge + size + edge,
            edge + size + edge * e.p + edge * fadeOutFrom * (1 - e.p)
          )
        ),
        edge + size + edge
      ];
      const pointMax = points[points.length - 1];
      let gradientStops = [];
      gradientStops.push([
        Math.min(1, points[0] / pointMax),
        `rgba(0,0,0,${darkest})`
      ]);
      for (let i = 0; i < keyframes.length; i++) {
        const e = keyframes[i];
        gradientStops.push([
          Math.min(1, points[0 + keyframes.length - i] / pointMax),
          `rgba(0,0,0,${e.o})`,
          i,
          e
        ]);
      }
      gradientStops.push([
        Math.min(1, points[1 + keyframes.length] / pointMax),
        `rgba(0,0,0,0)`
      ]);
      gradientStops.push([
        Math.min(1, points[2 + keyframes.length] / pointMax),
        `rgba(0,0,0,0)`
      ]);
      keyframes.reverse();
      for (let i = 0; i < keyframes.length; i++) {
        const e = keyframes[i];
        gradientStops.push([
          Math.min(1, points[2 + keyframes.length * 2 - i] / pointMax),
          `rgba(0,0,0,${e.o})`,
          i,
          e
        ]);
      }
      gradientStops.push([
        Math.min(1, points[3 + keyframes.length * 2] / pointMax),
        `rgba(0,0,0,${darkest})`
      ]);
      gradientStops = gradientStops.map((args2) => [
        Math.round(args2[0] * 1e4) / 1e4,
        args2[1],
        args2[2],
        args2[3]?.p,
        args2[3]?.o
      ]);
      const gradient = this.ctx.createLinearGradient(
        0,
        0,
        horizontal ? WIDTH : 0,
        !horizontal ? HEIGHT : 0
      );
      for (let i = 0; i < gradientStops.length; i++) {
        const gs = gradientStops[i];
        try {
          gradient.addColorStop(...gs);
        } catch (ex) {
          ex.details = {
            i,
            gs,
            size,
            edge,
            fadeOutFrom,
            darkest,
            horizontal,
            \u03A9points: JSON.parse(JSON.stringify(points)),
            \u03A9keyframes: JSON.parse(JSON.stringify(keyframes)),
            \u03A9gradientStops: JSON.parse(JSON.stringify(gradientStops))
          };
          throw ex;
        }
      }
      this.ctx.fillStyle = gradient;
      this.ctx.fillRect(0, 0, WIDTH, HEIGHT);
    };
  };

  // src/storage.js
  var storage = {
    async get(key) {
      try {
        const v = localStorage.getItem("vp:ambilight:" + key);
        return v == null ? void 0 : JSON.parse(v);
      } catch {
        return void 0;
      }
    },
    async set(key, value) {
      try {
        value === void 0 ? localStorage.removeItem("vp:ambilight:" + key) : localStorage.setItem("vp:ambilight:" + key, JSON.stringify(value));
      } catch {
      }
    }
  };

  // src/projector-webgl.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/projector-webgl.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var ProjectorWebGL = class _ProjectorWebGL {
    type = "ProjectorWebGL";
    lostCount = 0;
    blurLostCount = 0;
    scales = [{ x: 1, y: 1 }];
    projectors = [];
    static subProjectorDimensionMax = 3;
    atTop = true;
    constructor(ambientlight, containerElem, initProjectorListeners, settings) {
      return async function ProjectorWebGLConstructor() {
        this.ambientlight = ambientlight;
        this.atTop = ambientlight.atTop;
        this.containerElem = containerElem;
        this.initProjectorListeners = initProjectorListeners;
        this.settings = settings;
        this.setWarning = settings.setWarning;
        this.initShadow();
        this.initBlurCtx();
        const initialized = await this.initCtx();
        if (!initialized) this.setWebGLWarning("create");
        this.initializedTime = performance.now();
        return this;
      }.bind(this)();
    }
    invalidateShaderCache() {
      this.viewport = void 0;
      this.fVibrance = void 0;
      this.vPosition = void 0;
      this.vUV = void 0;
      this.cropped = void 0;
      this.fScale = void 0;
      this.fScaleStep = void 0;
      this.fScalesLength = void 0;
      this.fCrop = void 0;
      this.fTextureMipmapLevel = void 0;
      this.fTextureOpacity = void 0;
      this.drawTextureSize = {
        width: 0,
        height: 0
      };
    }
    handleWindowResize = async () => {
      if (this.ambientlight.isPageHidden) return;
      this.updateCrop();
      await this.ambientlight.optionalFrame();
    };
    handleAtTopChange = async (atTop) => {
      this.atTop = atTop;
      if (this.ambientlight.isPageHidden) return;
      this.updateCrop();
      this.ambientlight.buffersCleared = true;
      await this.ambientlight.optionalFrame();
    };
    remove() {
      this.containerElem.remove(this.elem);
    }
    // TODO: Cut off left, top and right canvas outside the browser + blur size
    resize(width, height) {
      this.width = width;
      this.height = height;
    }
    initShadow() {
      this.shadow = new ProjectorShadow();
      this.projectors[2] = {
        elem: this.shadow.elem,
        ctx: this.blurCtx
      };
    }
    drawIndex = 0;
    drawBorder = 0;
    drawTextureSize = {
      width: 0,
      height: 0
    };
    draw = (src) => {
      if (!this.ctx || this.ctxIsInvalid || src.ctx?.ctxIsInvalid || this.lost || !this.viewport)
        return;
      if (this.projectorsCount > 1 && this.projectorsCount !== this.fTextureOpacity?.length)
        return;
      if (!this.cropped) this.updateCrop();
      const srcWidth = src.videoWidth || src.width;
      const srcHeight = src.videoHeight || src.height;
      const textureMipmapLevel = Math.max(
        0,
        Math.log(srcHeight / this.height) / Math.log(2) - 0
      );
      if (textureMipmapLevel !== this.fTextureMipmapLevel) {
        this.fTextureMipmapLevel = textureMipmapLevel;
        this.ctx.uniform1f(this.fTextureMipmapLevelLoc, textureMipmapLevel);
      }
      const subProjectorsDimensionMultiplier = Math.sqrt(this.subProjectorsCount);
      const textureSize = this.projectorsCount > 1 ? {
        width: (srcWidth + this.drawBorder) * subProjectorsDimensionMultiplier,
        height: (srcHeight + this.drawBorder) * subProjectorsDimensionMultiplier
      } : {
        width: srcWidth,
        height: srcHeight
      };
      const updateTextureSize = this.drawTextureSize.width !== textureSize.width || this.drawTextureSize.height !== textureSize.height;
      const blurCanvasBound = Math.floor(this.blurBound / this.blurCanvasScale);
      const blurCanvasWidthMinBounds = this.blurCanvas.width - blurCanvasBound * 2;
      const blurCanvasHeightMinBounds = this.blurCanvas.height - blurCanvasBound * 2;
      const internalFormat = this.ctx.RGBA;
      const format = this.ctx.RGBA;
      const formatType = this.ctx.UNSIGNED_BYTE;
      let start = this.settings.showResolutions ? performance.now() : void 0;
      if (this.projectorsCount > 1) {
        if (updateTextureSize) {
          this.drawInitial = true;
          this.drawIndex = 0;
        }
        const filledOpacities = this.fTextureOpacity.slice(
          this.projectorsCount - 1 - this.drawIndex
        );
        const emptyOpacities = this.fTextureOpacity.slice(
          0,
          this.projectorsCount - 1 - this.drawIndex
        );
        const opacities = [
          ...this.drawInitial ? filledOpacities.map(
            (o, i) => i === 0 ? emptyOpacities.reduce((s, o2) => s + o2, o) : o
          ) : filledOpacities,
          ...this.drawInitial ? emptyOpacities.map(() => 0) : emptyOpacities
        ];
        const textureIndex = Math.floor(this.drawIndex / this.subProjectorsCount);
        const previousTextureIndex = Math.floor(
          (this.drawIndex - 1) / this.subProjectorsCount
        );
        const isNewTexture = textureIndex !== previousTextureIndex;
        const drawInitialAndIsNewTexture = this.drawInitial && isNewTexture;
        const subIndex = this.drawIndex % this.subProjectorsCount;
        const xIndex = subIndex % subProjectorsDimensionMultiplier;
        const yIndex = Math.floor(subIndex / subProjectorsDimensionMultiplier) % subProjectorsDimensionMultiplier;
        const x = (srcWidth + this.drawBorder) * xIndex;
        const y = (srcHeight + this.drawBorder) * yIndex;
        if (this.drawInitial) {
          const isLastSubTexture = this.drawIndex == this.projectorsCount - 1;
          if (isLastSubTexture) this.drawInitial = false;
        }
        this.ctx.uniform1fv(this.fTextureOpacityLoc, new Float32Array(opacities));
        this.ctx.activeTexture(this.ctx[`TEXTURE${textureIndex + 1}`]);
        if (drawInitialAndIsNewTexture) {
          this.ctx.texImage2D(
            this.ctx.TEXTURE_2D,
            0,
            internalFormat,
            textureSize.width,
            textureSize.height,
            0,
            format,
            formatType,
            null
          );
        }
        this.ctx.texSubImage2D(
          this.ctx.TEXTURE_2D,
          0,
          x,
          y,
          format,
          formatType,
          src
        );
        this.ctx.generateMipmap(this.ctx.TEXTURE_2D);
      } else {
        if (updateTextureSize) {
          this.ctx.texImage2D(
            this.ctx.TEXTURE_2D,
            0,
            internalFormat,
            format,
            formatType,
            src
          );
        } else {
          this.ctx.texSubImage2D(
            this.ctx.TEXTURE_2D,
            0,
            0,
            0,
            format,
            formatType,
            src
          );
        }
        this.ctx.generateMipmap(this.ctx.TEXTURE_2D);
      }
      if (this.settings.showResolutions)
        this.loadTime = performance.now() - start;
      if (this.settings.showResolutions) start = performance.now();
      this.ctx.drawArrays(this.ctx.TRIANGLES, 0, this.vPosition.length / 2);
      const isNewTextureUpload = this.drawTextureSize.width === 0 && this.drawTextureSize.height === 0;
      if (isNewTextureUpload) {
        this.checkForDrawErrors();
      }
      if (this.settings.showResolutions)
        this.drawTime = performance.now() - start;
      if (this.settings.showResolutions) start = performance.now();
      this.blurCtx.clearRect(0, 0, this.blurCanvas.width, this.blurCanvas.height);
      if (this.settings.showResolutions) {
        this.blurClearTime = performance.now() - start;
        start = performance.now();
      }
      this.blurCtx.drawImage(
        this.elem,
        blurCanvasBound,
        blurCanvasBound,
        blurCanvasWidthMinBounds,
        blurCanvasHeightMinBounds
      );
      if (this.settings.showResolutions)
        this.blurDrawTime = performance.now() - start;
      if (updateTextureSize) {
        this.drawTextureSize = textureSize;
      }
      this.drawIndex = (this.drawIndex + 1 + Math.round(Math.random() * 0.5)) % this.projectorsCount;
    };
    drawErrors = [];
    checkForDrawErrors = () => {
      const webGLError = this.ctx.getError();
      if (webGLError === this.ctx.NO_ERROR) {
        this.drawErrors.length = 0;
        this.setWarning("");
        return;
      }
      this.drawInitial = true;
      const error = new AmbientlightError(
        `WebGL error: ${webGLErrorToString(webGLError)}`,
        {
          program: this.program?.toString(),
          webGLVersion: this.webGLVersion,
          majorPerformanceCaveat: this.majorPerformanceCaveat,
          ctxOptions: this.ctxOptions
        }
      );
      error.name = "ProjectorWebGLDrawError";
      this.drawErrors.push(error);
      if (this.drawErrors.length < 3) {
        console.warn(error);
        this.ambientlight.setDrawWarning(error);
        return;
      }
      error.details.previousErrors = this.drawErrors.slice(0, -1);
      throw error;
    };
    setWebGLWarning(action = "restore") {
      this.setWarning(
        `Failed to ${action} the WebGL renderer from a GPU crash.${canvasWebGLCrashTips}`
      );
    }
    onBlurCtxLost = wrapErrorHandler(
      function wrappedOnBlurCtxLost(event) {
        event.preventDefault();
        this.blurLost = true;
        this.blurLostCount++;
        this.invalidateShaderCache();
        if (this.shadow?.elem) {
          this.shadow.elem.width = 1;
        }
        console.log(`ProjectorWebGL blur context lost (${this.blurLostCount})`);
        this.setWebGLWarning("restore");
        this.ambientlight.barDetection.clear();
      }.bind(this)
    );
    onBlurCtxRestored = wrapErrorHandler(
      async function wrappedOnBlurCtxRestored() {
        console.log(
          `ProjectorWebGL blur context restored (${this.blurLostCount})`
        );
        if (this.blurLostCount >= 3) {
          console.error(
            "ProjectorWebGL blur context was lost 3 times. The current restoration has been aborted to prevent an infinite restore loop."
          );
          this.setWebGLWarning("3 times restore");
          return;
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
        this.initBlurCtx();
        if (this.blurCtx && (!this.blurCtx.isContextLost || !this.blurCtx.isContextLost())) {
          if (!this.ctxIsInvalid) {
            this.initProjectorListeners();
            this.blurLost = false;
            if (!this.lost && !this.ambientlight.projectorBuffer?.lost)
              this.setWarning("");
            this.ambientlight.barDetection.clear();
          }
        } else {
          console.error(
            `ProjectorWebGL blur context restore failed (${this.blurLostCount})`
          );
          this.setWebGLWarning("restore");
        }
      }.bind(this)
    );
    initBlurCtx() {
      if (this.blurCanvas) {
        this.containerElem.removeChild(this.blurCanvas);
        if (this.blurCtx) {
          this.blurCanvas.removeEventListener("contextlost", this.onBlurCtxLost);
          this.blurCanvas.removeEventListener(
            "contextrestored",
            this.onBlurCtxRestored
          );
        }
      }
      this.blurCanvas = document.createElement("canvas");
      this.blurCanvas.classList.add("ambientlight__projector");
      this.containerElem.prepend(this.blurCanvas);
      this.boundaryElem = this.blurCanvas;
      this.blurCanvas.addEventListener("contextlost", this.onBlurCtxLost);
      this.blurCanvas.addEventListener("contextrestored", this.onBlurCtxRestored);
      this.blurCtx = this.blurCanvas.getContext("2d", {
        ...ctxOptions,
        alpha: true,
        desynchronized: false
        // true: Does not work when canvas elements are not hardware accelerated
      });
      if (!this.blurCtx) {
        throw new Error("ProjectorWebGL blur context creation failed");
      }
      this.projectors[0] = {
        elem: this.blurCanvas,
        ctx: this.blurCtx
      };
      if (this.blurLost) {
        this.blurLost = false;
      }
    }
    async getMajorPerformanceCaveatDetected() {
      try {
        return await storage.get("majorPerformanceCaveatDetected") || false;
      } catch (ex) {
        SentryReporter.captureException(ex);
      }
    }
    async majorPerformanceCaveatDetected() {
      this.majorPerformanceCaveat = true;
      const detected = await this.getMajorPerformanceCaveatDetected();
      if (detected) return;
      const message = "The browser warned that this is a slow device. If you have a graphics card, make sure to enable hardware acceleration in the browser.\n(The resolution setting has been turned down to 25% for better performance)";
      this.setWarning(message, true);
      this.settings.set("resolution", 25, true);
      await storage.set("majorPerformanceCaveatDetected", true);
    }
    async noMajorPerformanceCaveatDetected() {
      this.majorPerformanceCaveat = false;
      const detected = await this.getMajorPerformanceCaveatDetected();
      if (detected === false) return;
      await storage.set("majorPerformanceCaveatDetected", false);
    }
    onCtxLost = wrapErrorHandler(
      function projectorCtxLost(event) {
        event.preventDefault();
        this.lost = true;
        this.lostCount++;
        this.program = void 0;
        this.invalidateShaderCache();
        console.log(`ProjectorWebGL context lost (${this.lostCount})`);
        this.setWebGLWarning("restore");
      }.bind(this)
    );
    onCtxRestored = wrapErrorHandler(
      async function projectorCtxRestored() {
        if (this.lostCount >= 3) {
          console.error("ProjectorWebGL context restore failed 3 times");
          this.setWebGLWarning("3 times restore");
          return;
        }
        try {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          if (!await this.initCtx()) return;
        } catch (ex) {
          this.setWebGLWarning();
          throw ex;
        }
        this.initShadow();
        this.initBlurCtx();
        if (this.ctx) {
          if (!this.ctxIsInvalid) {
            this.initProjectorListeners();
            this.lost = false;
            if (!this.blurLost && !this.ambientlight.projectorBuffer?.lost)
              this.setWarning("");
          }
        } else {
          console.error(
            `ProjectorWebGL context restore failed (${this.lostCount})`
          );
          this.setWebGLWarning("restore");
          return;
        }
        if (this.handleRestored) this.handleRestored();
      }.bind(this)
    );
    webglcontextcreationerrors = [];
    onCtxCreationError = wrapErrorHandler(
      function projectorCtxCreationError(e) {
        this.webglcontextcreationerrors.push({
          webGLVersion: this.webGLVersion,
          failIfMajorPerformanceCaveat: this.ctxOptions.failIfMajorPerformanceCaveat,
          message: e.statusMessage || "?",
          time: performance.now()
        });
      }.bind(this)
    );
    // syncCompilation prevents black flickering while settings are changed
    async initCtx(syncCompilation = false) {
      if (this.cancelCompilation) return false;
      if (this.compilationPromise) {
        this.cancelCompilation = true;
        await this.compilationPromise;
        this.cancelCompilation = void 0;
      }
      if ((this.webGLVersion === 2 || this.webGLVersion === 1) && !this.ctx && this.elem) {
        this.elem.removeEventListener("contextlost", this.onCtxLost);
        this.elem.removeEventListener("contextrestored", this.onCtxRestored);
        this.elem.removeEventListener(
          "webglcontextcreationerror",
          this.onCtxCreationError
        );
        this.elem = void 0;
        this.webGLVersion = void 0;
      }
      if (!this.elem) {
        this.elem = new SafeOffscreenCanvas(1, 1);
        this.elem.addEventListener("webglcontextlost", this.onCtxLost, false);
        this.elem.addEventListener(
          "webglcontextrestored",
          this.onCtxRestored,
          false
        );
        this.elem.addEventListener(
          "webglcontextcreationerror",
          this.onCtxCreationError,
          false
        );
      }
      if (!this.ctx) {
        this.ctxOptions = {
          failIfMajorPerformanceCaveat: true,
          preserveDrawingBuffer: false,
          // Allows the browser to swap the visible- and drawbuffers, which is faster
          premultipliedAlpha: false,
          alpha: true,
          depth: false,
          antialias: false,
          desynchronized: false
        };
        this.webGLVersion = 2;
        this.ctx = this.elem.getContext("webgl2", this.ctxOptions);
        if (this.ctx) {
          this.noMajorPerformanceCaveatDetected();
        } else {
          this.webGLVersion = 1;
          this.ctx = this.elem.getContext("webgl", this.ctxOptions);
          if (this.ctx) {
            this.noMajorPerformanceCaveatDetected();
          } else {
            this.ctxOptions.failIfMajorPerformanceCaveat = false;
            this.webGLVersion = 2;
            this.ctx = this.elem.getContext("webgl2", this.ctxOptions);
            if (this.ctx) {
              this.majorPerformanceCaveatDetected();
            } else {
              this.webGLVersion = 1;
              this.ctx = this.elem.getContext("webgl", this.ctxOptions);
              if (this.ctx) {
                this.majorPerformanceCaveatDetected();
              } else {
                this.webGLVersion = void 0;
                await new Promise((resolve) => setTimeout(resolve, 1e3));
                const errors = this.webglcontextcreationerrors;
                this.webglcontextcreationerrors = [];
                let lastErrorMessage = "";
                for (const error of errors) {
                  const duplicate = error.message === lastErrorMessage;
                  lastErrorMessage = error.message;
                  if (duplicate) error.message = '"';
                }
                throw new AmbientlightError(
                  `ProjectorWebGL context creation failed: ${lastErrorMessage}`,
                  errors
                );
              }
            }
          }
        }
      }
      if (!this.ctx || this.ctx.isContextLost()) return;
      if ("drawingBufferColorSpace" in this.ctx && "unpackColorSpace" in this.ctx) {
        this.ctx.drawingBufferColorSpace = ctxOptions.colorSpace;
        this.ctx.unpackColorSpace = ctxOptions.colorSpace;
      }
      this.projectors[1] = {
        elem: this.elem,
        ctx: this
      };
      const program = this.ctx.createProgram();
      this.ctx.hint(this.ctx.GENERATE_MIPMAP_HINT, this.ctx.NICEST);
      const tfaExt = this.ctx.getExtension("EXT_texture_filter_anisotropic") || this.ctx.getExtension("MOZ_EXT_texture_filter_anisotropic") || this.ctx.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
      const maxAnisotropy = tfaExt ? Math.min(
        16,
        this.ctx.getParameter(tfaExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1
      ) : 0;
      this.shadowTexture = this.ctx.createTexture();
      this.ctx.activeTexture(this.ctx.TEXTURE0);
      this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.shadowTexture);
      this.ctx.texParameteri(
        this.ctx.TEXTURE_2D,
        this.ctx.TEXTURE_MIN_FILTER,
        this.ctx.LINEAR
      );
      this.ctx.texParameteri(
        this.ctx.TEXTURE_2D,
        this.ctx.TEXTURE_MAG_FILTER,
        this.ctx.LINEAR
      );
      this.ctx.texParameteri(
        this.ctx.TEXTURE_2D,
        this.ctx.TEXTURE_WRAP_S,
        this.ctx.CLAMP_TO_EDGE
      );
      this.ctx.texParameteri(
        this.ctx.TEXTURE_2D,
        this.ctx.TEXTURE_WRAP_T,
        this.ctx.CLAMP_TO_EDGE
      );
      this.ctx.texImage2D(
        this.ctx.TEXTURE_2D,
        0,
        this.ctx.RGBA,
        1,
        1,
        0,
        this.ctx.RGBA,
        this.ctx.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255])
      );
      this.projectorsTexture = [];
      const maxTextures = Math.min(
        this.ctx.getParameter(this.ctx.MAX_TEXTURE_IMAGE_UNITS) || 8,
        16
      );
      const maxProjectorTextures = maxTextures - 1;
      _ProjectorWebGL.subProjectorDimensionMax = this.webGLVersion === 2 ? 3 : 2;
      this.subProjectorsCount = 1;
      const frameFading = Math.round(Math.pow(this.settings.frameFading, 2));
      for (let i = 1; i < _ProjectorWebGL.subProjectorDimensionMax && frameFading + 1 > maxProjectorTextures * Math.pow(i, 2); i++) {
        this.subProjectorsCount = Math.pow(i + 1, 2);
      }
      this.projectorsCount = Math.min(
        frameFading + 1,
        maxProjectorTextures * this.subProjectorsCount
      );
      const projectorsTextureCount = Math.ceil(
        this.projectorsCount / this.subProjectorsCount
      );
      for (let i = 0; i < projectorsTextureCount; i++) {
        this.projectorsTexture[i] = this.ctx.createTexture();
        this.ctx.activeTexture(this.ctx[`TEXTURE${i + 1}`]);
        this.ctx.bindTexture(this.ctx.TEXTURE_2D, this.projectorsTexture[i]);
        this.ctx.texParameteri(
          this.ctx.TEXTURE_2D,
          this.ctx.TEXTURE_MIN_FILTER,
          this.ctx.LINEAR_MIPMAP_LINEAR
        );
        this.ctx.texParameteri(
          this.ctx.TEXTURE_2D,
          this.ctx.TEXTURE_MAG_FILTER,
          this.ctx.LINEAR
        );
        this.ctx.texParameteri(
          this.ctx.TEXTURE_2D,
          this.ctx.TEXTURE_WRAP_S,
          this.ctx.CLAMP_TO_EDGE
        );
        this.ctx.texParameteri(
          this.ctx.TEXTURE_2D,
          this.ctx.TEXTURE_WRAP_T,
          this.ctx.CLAMP_TO_EDGE
        );
        if (this.webGLVersion !== 1) {
          this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            this.ctx.TEXTURE_MAX_LEVEL,
            16
          );
        }
        if (maxAnisotropy) {
          this.ctx.texParameteri(
            this.ctx.TEXTURE_2D,
            tfaExt.TEXTURE_MAX_ANISOTROPY_EXT,
            maxAnisotropy
          );
        }
        this.ctx.texImage2D(
          this.ctx.TEXTURE_2D,
          0,
          this.ctx.RGBA,
          1,
          1,
          0,
          this.ctx.RGBA,
          this.ctx.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 255])
        );
        this.ctx.generateMipmap(this.ctx.TEXTURE_2D);
      }
      const vertexShaderSrc = `
      precision lowp float;

      attribute vec2 vPosition;

      attribute vec2 vUV;
      varying vec2 fUV;
      
      void main(void) {
        fUV = vUV;
        gl_Position = vec4(vPosition, 0, 1);
      }
    `.replace(/\n {6}/g, "\n").replace(/ +\n/g, "").replace(/\n+/g, "\n").trim();
      const vertexShader = this.ctx.createShader(this.ctx.VERTEX_SHADER);
      this.ctx.shaderSource(vertexShader, vertexShaderSrc);
      this.ctx.compileShader(vertexShader);
      this.ctx.attachShader(program, vertexShader);
      const fragmentShaderSrc = `
      precision lowp float;
      varying vec2 fUV;
      uniform sampler2D textureSampler[${this.projectorsTexture.length}];
      uniform float fTextureMipmapLevel;
      ${this.projectorsCount > 1 ? `uniform float fTextureOpacity[${this.projectorsCount}];` : ""}
      uniform vec2 fCropOffsetUV;
      uniform vec2 fCropScaleUV;
      uniform sampler2D shadowSampler;
      uniform vec2 fScale;
      uniform vec2 fScaleStep;
      ${this.settings.vibrance !== 100 ? "uniform float fVibrance;" : ""}

      vec4 multiTexture() {
        vec2 direction = ceil(fUV * 2.) - 1.;
        vec2 iUV = ((direction - fUV) * fScale) / ((direction - .5) * fScaleStep);
        int impreciseI = int(min(iUV[0], iUV[1]));
        for (int preciseI = 0; preciseI < 200; preciseI++) {
          if (preciseI < impreciseI) continue;
          int i = ${this.webGLVersion === 1 ? "impreciseI" : "preciseI"};
          vec2 scaledUV = (fUV - .5) * (fScale / (fScale - fScaleStep * vec2(i)));
          vec2 croppedUV = fCropOffsetUV + (scaledUV / fCropScaleUV);
          
          ${(() => {
        if (this.projectorsCount > 1) {
          const subProjectorsDimensionMultiplier = Math.sqrt(
            this.subProjectorsCount
          );
          const croppedUvScale = (1 / subProjectorsDimensionMultiplier).toString().padEnd(2, ".");
          return `${new Array(this.subProjectorsCount).fill(void 0).map((_, i) => {
            if (i === 0)
              return `vec2 uv0 = ${croppedUvScale !== "1." ? `(croppedUV * ${croppedUvScale})` : "croppedUV"};`;
            const xIndex = i % subProjectorsDimensionMultiplier;
            const yIndex = Math.floor(i / subProjectorsDimensionMultiplier) % subProjectorsDimensionMultiplier;
            const offsetUVx = (1 / subProjectorsDimensionMultiplier * xIndex).toString().padEnd(2, ".");
            const offsetUVy = (1 / subProjectorsDimensionMultiplier * yIndex).toString().padEnd(2, ".");
            return `vec2 uv${i} = uv0${offsetUVx !== "0." || offsetUVy !== "0." ? ` + vec2(${offsetUVx},${offsetUVy})` : ""};`;
          }).join("\n")}`;
        } else {
          return ``;
        }
      })()}

          return ${(() => {
        if (this.projectorsCount > 1) {
          return `${new Array(this.projectorsCount).fill(void 0).map((_, i) => {
            const projectorIndex = Math.floor(
              i / this.subProjectorsCount
            );
            const subIndex = i % this.subProjectorsCount;
            return `(fTextureOpacity[${i}] * texture2D(textureSampler[${projectorIndex}], uv${subIndex}, fTextureMipmapLevel))`;
          }).join("\n+ ")};`;
        } else {
          return `texture2D(textureSampler[0], croppedUV, fTextureMipmapLevel);`;
        }
      })()}
        }
        return vec4(0.0, 0.0, 0.0, 1.0);
      }
      
      ${this.settings.vibrance !== 100 ? `
      vec3 rgb2hsv(vec3 c)
      {
          vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

          float d = q.x - min(q.w, q.y);
          float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }

      vec3 hsv2rgb(vec3 c)
      {
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }

      float saturate(float c, float v) {
        float x = c;
        if(v < 0.) {
          x = 1. - c;
        }

        float a = 1. + 5. * (1. - abs(v));
        float y = a * a - x * ( (a * a - 1.) / (a * a) ) - (a - x / a) * (a - x / a);
        float d = y - x;
        y = min(1., x + d * 5.);

        if(v >= 0.) {
          return y;
        } else {
          return 1. - y;
        }
      }
      ` : ""}

      void main(void) {
        vec3 ambientlight = multiTexture().rgb;
        float shadowAlpha = texture2D(shadowSampler, fUV).a;
        ${this.settings.vibrance !== 100 ? `
          if(fVibrance != 0.) {
            vec3 ambientlightHSV = rgb2hsv(ambientlight);
            ambientlightHSV[1] = saturate(ambientlightHSV[1], fVibrance);
            ambientlight = hsv2rgb(ambientlightHSV);
          }
        ` : ""}
        gl_FragColor = vec4(ambientlight, 1. - shadowAlpha);
      }
    `.replace(/\n {6}/g, "\n").replace(/ +\n/g, "").replace(/\n+/g, "\n").trim();
      const fragmentShader = this.ctx.createShader(this.ctx.FRAGMENT_SHADER);
      this.ctx.shaderSource(fragmentShader, fragmentShaderSrc);
      this.ctx.compileShader(fragmentShader);
      this.ctx.attachShader(program, fragmentShader);
      if (this.program) {
        try {
          this.ctx.finish();
          this.ctx.deleteProgram(this.program);
        } catch (ex) {
          console.warn("Failed to delete previous ProjectorWebGL program", ex);
        }
        this.program = void 0;
        this.invalidateShaderCache();
      }
      this.ctx.linkProgram(program);
      const parallelShaderCompileExt = syncCompilation ? void 0 : this.ctx.getExtension("KHR_parallel_shader_compile");
      if (parallelShaderCompileExt?.COMPLETION_STATUS_KHR) {
        let resolveCompilationPromise;
        this.compilationPromise = new Promise(
          (resolve) => resolveCompilationPromise = async () => {
            resolveCompilationPromise = void 0;
            await new Promise((resolve2) => setTimeout(resolve2, 0));
            this.compilationPromise = void 0;
            resolve();
          }
        );
        this.ctx.getProgramParameter(
          program,
          parallelShaderCompileExt.COMPLETION_STATUS_KHR
        );
        await new Promise((resolve) => requestAnimationFrame(resolve));
        try {
          let compiled = false;
          while (!compiled) {
            const completionStatus = this.ctx.getProgramParameter(
              program,
              parallelShaderCompileExt.COMPLETION_STATUS_KHR
            );
            if (completionStatus === false) {
              await new Promise(
                (resolve) => requestIdleCallback(resolve, { timeout: 200 })
              );
              await new Promise((resolve) => requestAnimationFrame(resolve));
            } else {
              compiled = true;
            }
          }
          if (this.cancelCompilation && compiled) {
            try {
              compiled = false;
              this.ctx.deleteProgram(program);
            } catch (ex) {
              console.warn("Failed to delete new ProjectorWebGL program", ex);
            }
          }
          resolveCompilationPromise();
          if (!compiled) return false;
        } catch (ex) {
          try {
            ex.details = {
              program: program?.toString(),
              webGLVersion: this.webGLVersion,
              majorPerformanceCaveat: this.majorPerformanceCaveat,
              ctxOptions: this.ctxOptions
            };
          } catch (ex2) {
            ex2.details = {
              detailsException: ex2
            };
          }
          resolveCompilationPromise();
          throw ex;
        }
      }
      const vertexShaderCompiled = this.ctx.getShaderParameter(
        vertexShader,
        this.ctx.COMPILE_STATUS
      );
      const fragmentShaderCompiled = this.ctx.getShaderParameter(
        fragmentShader,
        this.ctx.COMPILE_STATUS
      );
      const programLinked = this.ctx.getProgramParameter(
        program,
        this.ctx.LINK_STATUS
      );
      if (!vertexShaderCompiled || !fragmentShaderCompiled || !programLinked) {
        const programCompilationError = new Error("Program compilation failed");
        programCompilationError.name = "WebGLError";
        programCompilationError.details = {
          webGLVersion: this.webGLVersion,
          ctxOptions: this.ctxOptions
        };
        try {
          programCompilationError.details = {
            ...programCompilationError.details,
            vertexShaderCompiled,
            vertexShaderInfoLog: this.ctx.getShaderInfoLog(vertexShader),
            fragmentShaderCompiled,
            fragmentShaderInfoLog: this.ctx.getShaderInfoLog(fragmentShader),
            programLinked,
            programInfoLog: this.ctx.getProgramInfoLog(program)
          };
        } catch (ex) {
          programCompilationError.details.getCompiledAndLinkedInfoLogsError = ex;
        }
        try {
          this.ctx.validateProgram(program);
          programCompilationError.details.programValidated = this.ctx.getProgramParameter(program, this.ctx.VALIDATE_STATUS);
          programCompilationError.details.programValidationInfoLog = this.ctx.getProgramInfoLog(program);
        } catch (ex) {
          programCompilationError.details.validateProgramError = ex;
        }
        try {
          const ext = this.ctx.getExtension("WEBGL_debug_shaders");
          if (ext) {
            programCompilationError.details.\u03A9sources = {
              vertexShader: ext.getTranslatedShaderSource(vertexShader),
              fragmentShader: ext.getTranslatedShaderSource(fragmentShader)
            };
            if (!programCompilationError.details.\u03A9sources.vertexShader) {
              programCompilationError.details.\u03A9sources.vertexShaderCode = vertexShaderSrc;
            }
            if (!programCompilationError.details.\u03A9sources.fragmentShader) {
              programCompilationError.details.\u03A9sources.fragmentShaderCode = fragmentShaderSrc;
            }
          }
        } catch (ex) {
          programCompilationError.details.debugShadersError = ex;
        }
        try {
          const debugRendererInfo = this.ctx.getExtension(
            "WEBGL_debug_renderer_info"
          );
          programCompilationError.details.gpuVendor = debugRendererInfo?.UNMASKED_VENDOR_WEBGL ? this.ctx.getParameter(debugRendererInfo.UNMASKED_VENDOR_WEBGL) : "unknown";
          programCompilationError.details.gpuRenderer = debugRendererInfo?.UNMASKED_RENDERER_WEBGL ? this.ctx.getParameter(debugRendererInfo.UNMASKED_RENDERER_WEBGL) : "unknown";
        } catch (ex) {
          programCompilationError.details.gpuError = ex;
        }
        if (programCompilationError.details.vertexShaderInfoLog || programCompilationError.details.fragmentShaderInfoLog || programCompilationError.details.getCompiledAndLinkedInfoLogsError || programCompilationError.details.programValidationInfoLog || programCompilationError.details.validateProgramError || programCompilationError.details.\u03A9sources?.vertexShader || programCompilationError.details.\u03A9sources?.vertexShaderCode || programCompilationError.details.\u03A9sources?.fragmentShader || programCompilationError.details.\u03A9sources?.fragmentShaderCode || programCompilationError.details.debugShadersError) {
          programCompilationError.name = "WebGLErrorWithInfoLog";
        }
        throw programCompilationError;
      }
      this.ctx.useProgram(program);
      this.program = program;
      const vUVLoc = this.ctx.getAttribLocation(this.program, "vUV");
      this.vUVBuffer = this.ctx.createBuffer();
      this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, this.vUVBuffer);
      this.ctx.vertexAttribPointer(
        vUVLoc,
        2,
        this.ctx.FLOAT,
        false,
        2 * Float32Array.BYTES_PER_ELEMENT,
        0
      );
      this.ctx.enableVertexAttribArray(vUVLoc);
      const vPositionLoc = this.ctx.getAttribLocation(this.program, "vPosition");
      this.vPositionBuffer = this.ctx.createBuffer();
      this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, this.vPositionBuffer);
      this.ctx.vertexAttribPointer(
        vPositionLoc,
        2,
        this.ctx.FLOAT,
        false,
        2 * Float32Array.BYTES_PER_ELEMENT,
        0
      );
      this.ctx.enableVertexAttribArray(vPositionLoc);
      const shadowSamplerLoc = this.ctx.getUniformLocation(
        this.program,
        "shadowSampler"
      );
      this.ctx.uniform1i(shadowSamplerLoc, 0);
      const textureSamplerLoc = this.ctx.getUniformLocation(
        this.program,
        "textureSampler"
      );
      this.ctx.uniform1iv(
        textureSamplerLoc,
        this.projectorsTexture.map((_, i) => 1 + i)
      );
      this.fTextureMipmapLevelLoc = this.ctx.getUniformLocation(
        this.program,
        "fTextureMipmapLevel"
      );
      this.ctx.uniform1f(this.fTextureMipmapLevelLoc, 0);
      if (this.settings.vibrance !== 100) {
        this.fVibranceLoc = this.ctx.getUniformLocation(
          this.program,
          "fVibrance"
        );
        this.ctx.uniform1f(this.fVibranceLoc, 0);
      }
      this.fScaleLoc = this.ctx.getUniformLocation(this.program, "fScale");
      this.ctx.uniform2fv(this.fScaleLoc, new Float32Array([1, 1]));
      this.fScaleStepLoc = this.ctx.getUniformLocation(
        this.program,
        "fScaleStep"
      );
      this.ctx.uniform2fv(this.fScaleStepLoc, new Float32Array([1, 1]));
      this.fCropOffsetUVLoc = this.ctx.getUniformLocation(
        this.program,
        "fCropOffsetUV"
      );
      this.ctx.uniform2fv(this.fCropOffsetUVLoc, new Float32Array([0, 0]));
      this.fCropScaleUVLoc = this.ctx.getUniformLocation(
        this.program,
        "fCropScaleUV"
      );
      this.ctx.uniform2fv(this.fCropScaleUVLoc, new Float32Array([0, 0]));
      if (this.projectorsCount > 1) {
        this.fTextureOpacityLoc = this.ctx.getUniformLocation(
          this.program,
          "fTextureOpacity"
        );
        this.ctx.uniform1fv(
          this.fTextureOpacityLoc,
          new Float32Array(Array(this.projectorsCount).fill(0))
        );
      }
      this.invalidateShaderCache();
      this.updateCtx();
      return true;
    }
    rescale(scales, lastScale, projectorSize, crop, settings) {
      if (this.shadow) {
        this.shadow.rescale(lastScale, projectorSize, settings);
      }
      this.scaleStep = {
        x: scales[2]?.x - scales[1]?.x,
        y: scales[2]?.y - scales[1]?.y
      };
      this.scale = lastScale;
      this.scalesLength = scales.length;
      this.crop = crop;
      const width = Math.floor(projectorSize.w * this.scale.x);
      const height = Math.floor(projectorSize.h * this.scale.y);
      if (this.elem) {
        this.elem.width = width;
        this.elem.height = height;
      }
      this.blurCanvasScale = settings.blur2 > 1 ? 2 : 1;
      const blurPx = settings.blur2 * (this.height / 512) * 1.275;
      const blurRadius = 2.64;
      this.blurBound = Math.max(1, Math.ceil(blurPx * blurRadius));
      if (this.blurCanvas) {
        const blurCanvasWidth = width + this.blurBound * 2;
        const blurCanvasHeight = height + this.blurBound * 2;
        const scaledWidth = Math.floor(blurCanvasWidth / this.blurCanvasScale);
        const scaledHeight = Math.floor(blurCanvasHeight / this.blurCanvasScale);
        if (this.blurCanvas.width !== scaledWidth)
          this.blurCanvas.width = scaledWidth;
        if (this.blurCanvas.height !== scaledHeight)
          this.blurCanvas.height = scaledHeight;
        this.blurCanvas.style.transform = `scale(${this.scale.x + this.blurBound * 2 / projectorSize.w}, ${this.scale.y + this.blurBound * 2 / projectorSize.h})`;
      }
      if (this.blurCtx) {
        this.blurCtx.filter = `blur(${blurPx / this.blurCanvasScale}px)`;
      }
      this.updateCtx();
    }
    async updateVibrance() {
      const hadVibranceFilter = this.fVibrance !== void 0;
      const hasVibranceFilter = this.settings.vibrance !== 100;
      if (hasVibranceFilter === hadVibranceFilter) return true;
      return await this.initCtx();
    }
    updateCtx() {
      if (this.ctxIsInvalid || this.lost) return;
      if (this.settings.vibrance !== 100) {
        let vibrance = this.settings.vibrance / 100 - 1;
        vibrance = (vibrance < 0 ? -1 : 1) * (1 - Math.pow(1 - Math.abs(vibrance), 3));
        const fVibranceChanged = this.fVibrance !== vibrance;
        if (fVibranceChanged) {
          this.fVibrance = vibrance;
          this.ctx.uniform1f(this.fVibranceLoc, this.fVibrance);
        }
      }
      const fScaleChanged = this.fScale?.x !== this.scale?.x || this.fScale?.y !== this.scale?.y;
      if (fScaleChanged) {
        this.fScale = this.scale;
        this.ctx.uniform2fv(
          this.fScaleLoc,
          new Float32Array([this.fScale?.x, this.fScale?.y])
        );
      }
      const fScaleStepChanged = this.fScaleStep?.x !== this.scaleStep?.x || this.fScaleStep?.y !== this.scaleStep?.y;
      if (fScaleStepChanged) {
        this.fScaleStep = this.scaleStep;
        this.ctx.uniform2fv(
          this.fScaleStepLoc,
          new Float32Array([this.fScaleStep?.x, this.fScaleStep?.y])
        );
      }
      const crop = this.crop || [0, 0];
      const fCropChanged = crop.some(
        (crop2, i) => crop2 !== (this.fCrop || [void 0, void 0])[i]
      );
      if (fCropChanged) {
        this.fCrop = crop;
        const fCropScaleUV = crop.map((crop2) => 1 / (1 - crop2 * 2));
        const fCropOffsetUV = fCropScaleUV.map(
          (cropScale, i) => crop[i] + 1 / (cropScale * 2)
        );
        this.ctx.uniform2fv(
          this.fCropOffsetUVLoc,
          new Float32Array(fCropOffsetUV)
        );
        this.ctx.uniform2fv(this.fCropScaleUVLoc, new Float32Array(fCropScaleUV));
      }
      if (this.projectorsCount > 1) {
        const fTextureOpacityChanged = this.projectorsCount > 1 && !(this.fTextureOpacity?.length === this.projectorsCount);
        if (fTextureOpacityChanged) {
          const easing = (x) => x * x;
          this.fTextureOpacity = new Array(this.projectorsCount).fill(void 0).map((_, i) => easing((i + 1) / this.projectorsCount)).map((e, i, list) => !i ? e : e - list[i - 1]);
        }
      }
      this.ctx.activeTexture(this.ctx.TEXTURE0);
      this.ctx.texImage2D(
        this.ctx.TEXTURE_2D,
        0,
        this.ctx.ALPHA,
        this.ctx.ALPHA,
        this.ctx.UNSIGNED_BYTE,
        this.shadow.elem
      );
      this.ctx.activeTexture(this.ctx.TEXTURE1);
      if (!this.viewport || this.viewport.width !== this.ctx.drawingBufferWidth || this.viewport.height !== this.ctx.drawingBufferHeight) {
        this.viewport = {
          width: this.ctx.drawingBufferWidth,
          height: this.ctx.drawingBufferHeight
        };
        this.ctx.viewport(
          0,
          0,
          this.ctx.drawingBufferWidth,
          this.ctx.drawingBufferHeight
        );
      }
      if (!this.cropped) {
        this.updateCrop();
      }
      if (!this.vPosition || !this.vUV) {
        this.updatePositionAndUvCoordinates();
      }
    }
    updateCrop() {
      if (this.ctxIsInvalid || this.lost || !this.blurCanvas || !this.ambientlight?.videoContainerElem)
        return;
      const videoBoundingElem = this.ambientlight.shouldStyleVideoParentElem ? this.ambientlight.videoContainerElem : this.ambientlight.videoElem;
      if (!videoBoundingElem) return;
      let videoRect = videoBoundingElem.getBoundingClientRect();
      if (!videoRect?.width || !videoRect?.height) return;
      const canvasRect = this.blurCanvas.getBoundingClientRect();
      if (!canvasRect?.width || !canvasRect?.height) return;
      const blurScale = canvasRect.height / this.blurCanvas.height;
      const blurSize = this.blurBound * blurScale;
      const windowRect = {
        left: -blurSize,
        top: -window.scrollY - blurSize,
        right: window.innerWidth + blurSize,
        bottom: window.innerHeight + blurSize
      };
      const canvasRectCenter = {
        x: canvasRect.left + canvasRect.width / 2,
        y: canvasRect.top + canvasRect.height / 2
      };
      const cropRect = {
        left: Math.max(canvasRect.left, windowRect.left),
        top: Math.max(canvasRect.top, windowRect.top),
        right: Math.min(canvasRect.right, windowRect.right),
        bottom: Math.min(
          canvasRect.bottom,
          windowRect.bottom + (this.settings.fixedPosition ? 0 : 100)
        )
        // 100 = a single scroll step
      };
      const cropPerc = {
        left: (canvasRectCenter.x - cropRect.left) / (canvasRectCenter.x - canvasRect.left),
        top: (canvasRectCenter.y - cropRect.top) / (canvasRectCenter.y - canvasRect.top),
        right: (cropRect.right - canvasRectCenter.x) / (canvasRect.right - canvasRectCenter.x),
        bottom: this.atTop || this.settings.fixedPosition ? (cropRect.bottom - canvasRectCenter.y) / (canvasRect.bottom - canvasRectCenter.y) : 1
      };
      const crop = {
        t: Math.max(0, cropPerc.top.toFixed(4)),
        r: Math.max(0, cropPerc.right.toFixed(4)),
        b: -Math.max(0, cropPerc.bottom.toFixed(4)),
        l: -Math.max(0, cropPerc.left.toFixed(4))
      };
      videoRect = this.settings.fixedPosition && !this.atTop ? {
        left: canvasRectCenter.x,
        top: canvasRectCenter.y,
        right: canvasRectCenter.x,
        bottom: canvasRectCenter.y
      } : {
        left: videoRect.left + blurSize,
        top: videoRect.top + blurSize,
        right: videoRect.right - blurSize,
        bottom: videoRect.bottom - blurSize
      };
      const cutPerc = {
        left: (canvasRectCenter.x - videoRect.left) / (canvasRectCenter.x - canvasRect.left),
        top: (canvasRectCenter.y - videoRect.top) / (canvasRectCenter.y - canvasRect.top),
        right: (videoRect.right - canvasRectCenter.x) / (canvasRect.right - canvasRectCenter.x),
        bottom: (videoRect.bottom - canvasRectCenter.y) / (canvasRect.bottom - canvasRectCenter.y)
      };
      const cut = {
        t: Math.min(Math.max(0, cutPerc.top.toFixed(4)), crop.t),
        r: Math.min(Math.max(0, cutPerc.right.toFixed(4)), crop.r),
        b: -Math.min(Math.max(0, cutPerc.bottom.toFixed(4)), -crop.b),
        l: -Math.min(Math.max(0, cutPerc.left.toFixed(4)), -crop.l)
      };
      this.updatePositionAndUvCoordinates(crop, cut);
      this.cropped = true;
    }
    updatePositionAndUvCoordinates(crop = { t: 1, r: 1, b: -1, l: -1 }, cut = { t: 0, r: 0, b: 0, l: 0 }) {
      const vPosition = [
        // Bottom
        crop.l,
        crop.b,
        crop.r,
        crop.b,
        cut.r,
        cut.b,
        crop.l,
        crop.b,
        cut.r,
        cut.b,
        cut.l,
        cut.b,
        // Right
        crop.r,
        crop.t,
        crop.r,
        crop.b,
        cut.r,
        cut.t,
        crop.r,
        crop.b,
        cut.r,
        cut.b,
        cut.r,
        cut.t,
        // Top
        crop.l,
        crop.t,
        cut.r,
        cut.t,
        cut.l,
        cut.t,
        crop.l,
        crop.t,
        crop.r,
        crop.t,
        cut.r,
        cut.t,
        // Left
        crop.l,
        crop.t,
        crop.l,
        crop.b,
        cut.l,
        cut.t,
        crop.l,
        crop.b,
        cut.l,
        cut.b,
        cut.l,
        cut.t
      ];
      if (JSON.stringify(this.vPosition) === JSON.stringify(vPosition)) return;
      this.vPosition = vPosition;
      this.ctx.clear(this.ctx.COLOR_BUFFER_BIT);
      this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, this.vPositionBuffer);
      this.ctx.bufferData(
        this.ctx.ARRAY_BUFFER,
        new Float32Array(this.vPosition),
        this.ctx.STATIC_DRAW
      );
      this.vUV = this.vPosition.map(
        (p, i) => ((i % 2 == 0 ? p : -p) + // Flip the y-axis of UV coördinates
        1) / 2
      );
      this.ctx.bindBuffer(this.ctx.ARRAY_BUFFER, this.vUVBuffer);
      this.ctx.bufferData(
        this.ctx.ARRAY_BUFFER,
        new Float32Array(this.vUV),
        this.ctx.STATIC_DRAW
      );
    }
    clearRect() {
      this.invalidateShaderCache();
      if (this.shadow?.elem) {
        this.shadow.elem.width = 1;
      }
      if (this.ctx && !this.ctx.isContextLost() && this.program) {
        this.ctx.activeTexture(this.ctx.TEXTURE0);
        this.ctx.texImage2D(
          this.ctx.TEXTURE_2D,
          0,
          this.ctx.RGBA,
          1,
          1,
          0,
          this.ctx.RGBA,
          this.ctx.UNSIGNED_BYTE,
          new Uint8Array([0, 0, 0, 255])
        );
        for (let i = 0; i < this.projectorsTexture.length; i++) {
          this.ctx.activeTexture(this.ctx[`TEXTURE${i + 1}`]);
          this.ctx.texImage2D(
            this.ctx.TEXTURE_2D,
            0,
            this.ctx.RGBA,
            1,
            1,
            0,
            this.ctx.RGBA,
            this.ctx.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 255])
          );
          this.ctx.generateMipmap(this.ctx.TEXTURE_2D);
        }
        this.ctx.clear(this.ctx.COLOR_BUFFER_BIT);
      }
      if (this.blurCtx && (!this.blurCtx.isContextLost || !this.blurCtx.isContextLost())) {
        this.blurCtx.clearRect(
          0,
          0,
          this.blurCanvas.width,
          this.blurCanvas.height
        );
      }
    }
    get ctxIsInvalid() {
      const invalid = !this.ctx || this.ctx.isContextLost() || !this.program || !this.blurCtx || this.blurCtx.isContextLost && this.blurCtx.isContextLost();
      if (invalid && !this.ctxIsInvalidWarned && !this.program) {
        this.ctxIsInvalidWarned = true;
        console.log(`ProjectorWebGL context is lost`);
      }
      return invalid;
    }
  };

  // src/projector-2d.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/projector-2d.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var Projector2d = class {
    type = "Projector2d";
    width = 1;
    height = 1;
    lostCount = 0;
    constructor(ambientlight, containerElem, initProjectorListeners, settings) {
      this.ambientlight = ambientlight;
      this.containerElem = containerElem;
      this.initProjectorListeners = initProjectorListeners;
      this.settings = settings;
      this.shadow = new ProjectorShadow(false);
      this.shadow.elem.classList.add("ambientlight__shadow");
      this.containerElem.appendChild(this.shadow.elem);
      this.boundaryElem = this.shadow.elem;
    }
    remove() {
      this.containerElem.remove(this.projectorListElem);
    }
    onProjectorCtxLost = () => {
      console.warn("Lost 2d projector");
      this.lostCount++;
      if (this.shadow?.elem) {
        this.shadow.elem.width = 1;
      }
      this.settings.setWarning(
        `Failed to restore the renderer from a GPU crash.${canvas2DCrashTips}`
      );
    };
    onProjectorCtxRestored = (event) => {
      if (this.lostCount >= 3 * this.projectors.length) {
        console.error("Projector2D context restore failed 3 times");
        this.settings.setWarning(
          `Failed to restore 3 times the renderer from a GPU crash.${canvas2DCrashTips}`
        );
        return;
      }
      console.warn("Restored 2d projector");
      const projectorElem = event.currentTarget;
      projectorElem.width = 1;
      this.ambientlight.buffersCleared = true;
      this.ambientlight.sizesChanged = true;
      this.ambientlight.barDetection.clear();
      if (this.scheduledRedrawAfterRestoreId)
        cancelAnimationFrame(this.scheduledRedrawAfterRestoreId);
      this.scheduledRedrawAfterRestoreId = raf(async () => {
        this.scheduledRedrawAfterRestoreId = void 0;
        await this.ambientlight.optionalFrame();
        this.initProjectorListeners();
        this.settings.setWarning("");
      });
    };
    recreate(levels) {
      this.levels = levels;
      if (!this.projectors) {
        this.projectors = [];
      }
      this.projectors = this.projectors.filter(function removeExcessProjector(projector, i) {
        if (i >= levels) {
          projector.elem.remove();
          return false;
        }
        return true;
      });
      for (let i = this.projectors.length; i < levels; i++) {
        const projectorElem = new Canvas(this.width, this.height);
        projectorElem.classList.add("ambientlight__projector");
        on(projectorElem, "contextlost", this.onProjectorCtxLost);
        on(projectorElem, "contextrestored", this.onProjectorCtxRestored);
        const projectorCtx = projectorElem.getContext("2d", ctxOptions);
        this.containerElem.prepend(projectorElem);
        this.projectors.push({
          elem: projectorElem,
          ctx: projectorCtx
        });
      }
    }
    resize(width, height) {
      this.width = width;
      this.height = height;
      for (const projector of this.projectors) {
        if (projector.elem.width !== width) projector.elem.width = width;
        if (projector.elem.height !== height) projector.elem.height = height;
      }
    }
    rescale(scales, lastScale, projectorSize, crop, settings) {
      this.crop = crop;
      for (let i = 0; i < scales.length; i++) {
        this.projectors[i].elem.style.transform = `scale(${scales[i].x}, ${scales[i].y})`;
      }
      this.shadow.rescale(lastScale, projectorSize, settings);
    }
    draw(src) {
      const srcWidth = src.videoWidth || src.width;
      const srcHeight = src.videoHeight || src.height;
      const croppedSrcX = srcWidth * this.crop[0];
      const croppedSrcY = srcHeight * this.crop[1];
      const croppedSrcWidth = srcWidth * (1 - this.crop[0] * 2);
      const croppedSrcHeight = srcHeight * (1 - this.crop[1] * 2);
      for (const projector of this.projectors) {
        projector.ctx.drawImage(
          src,
          croppedSrcX,
          croppedSrcY,
          croppedSrcWidth,
          croppedSrcHeight,
          0,
          0,
          projector.elem.width,
          projector.elem.height
        );
      }
    }
    clearRect() {
      for (const projector of this.projectors) {
        projector.ctx.clearRect(
          0,
          0,
          projector.elem.width,
          projector.elem.height
        );
      }
    }
  };

  // src/worker.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/worker.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var workerFromCode = async (func) => {
    try {
      if (typeof OffscreenCanvas === "undefined") {
        throw new Error("OffscreenCanvas class is undefined");
      } else if (!OffscreenCanvas.prototype.transferToImageBitmap) {
        throw new Error("OffscreenCanvas.transferToImageBitmap is undefined");
      }
      let created = () => void 0;
      let timeout;
      try {
        const promise = new Promise((resolve, reject) => {
          created = (error) => {
            if (error) return reject(error);
            resolve();
          };
        });
        const worker = new Worker(
          URL.createObjectURL(
            new Blob(["(", func.toString(), ")()"], { type: "text/javascript" })
          )
        );
        worker.onerror = (e) => created(
          new Error(
            e?.message ?? "Worker creation failed probably because it violates the worker-src or script-src Content Security Policy"
          )
        );
        worker.onmessage = (e) => {
          if (e.data === false) {
            created();
          }
        };
        worker.postMessage(false);
        timeout = setTimeout(
          () => created(new Error("Worker creation timed-out after 5 seconds")),
          5e3
        );
        await promise;
        worker.onerror = void 0;
        worker.onmessage = void 0;
        return worker;
      } finally {
        clearTimeout(timeout);
        created = void 0;
      }
    } catch (error) {
      console.warn(
        `Failed to create a native worker. Creating a fallback worker on the main thread instead (${error.message})`
      );
      class FallbackWorker {
        isFallbackWorker = true;
        constructor(func2) {
          const globalScope = this.globalScope = {
            postMessage: (data) => {
              if (this.onmessage)
                this.onmessage({
                  data
                });
            },
            onmessage: () => console.error("onmessage not implemented"),
            isFallbackWorker: true
          };
          func2.bind(globalScope)();
        }
        onerror = (error2) => {
          console.error(error2);
        };
        postMessage = (data) => {
          try {
            this.globalScope.onmessage({
              data
            });
          } catch (error2) {
            this.onerror(error2);
          }
        };
      }
      return new FallbackWorker(func);
    }
  };

  // src/bar-detection.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/bar-detection.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var workerCode = function() {
    class ImageHelper {
      imageData;
      channels = 4;
      get width() {
        return this.imageData?.width ?? 0;
      }
      get height() {
        return this.imageData?.height ?? 0;
      }
      getDataOffset(x, y) {
        return (y * this.width + x) * this.channels;
      }
      getPixel(x, y, data, dataOffset, alpha = true) {
        let returnValue = !data;
        if (returnValue) data = new Uint8Array(4);
        if (!dataOffset) dataOffset = 0;
        const offset = this.getDataOffset(x, y);
        if (offset < 0 || offset > (this.imageData?.data?.length ?? 0)) {
          data[dataOffset + 0] = 0;
          data[dataOffset + 1] = 0;
          data[dataOffset + 2] = 0;
          if (alpha) data[dataOffset + 3] = 0;
        } else {
          data[dataOffset + 0] = this.imageData?.data?.[offset];
          data[dataOffset + 1] = this.imageData?.data?.[offset + 1];
          data[dataOffset + 2] = this.imageData?.data?.[offset + 2];
          if (alpha) data[dataOffset + 3] = this.imageData?.data?.[offset + 3];
        }
        if (returnValue) return data;
      }
    }
    let catchedWorkerCreationError = false;
    let canvas;
    let canvasIsCreatedInWorker = false;
    let ctx;
    let globalRunId = 0;
    let globalXOffsetIndex = 0;
    let image = new ImageHelper();
    const scanlinesAmount = 5;
    const postError = (ex) => {
      if (!catchedWorkerCreationError) {
        catchedWorkerCreationError = true;
        this.postMessage({
          id: -1,
          error: ex
        });
      }
    };
    const sortSizes = (averageSize) => (a, b) => {
      const aGap = Math.abs(averageSize - a.yIndex);
      const bGap = Math.abs(averageSize - b.yIndex);
      return aGap === bGap ? 0 : aGap > bGap ? 1 : -1;
    };
    const colorChannels = image.channels - 1;
    const colorsLength = 116;
    const averageColorColorsData = new Uint8Array(colorsLength * colorChannels);
    const averageColorsIndexes = new Uint8Array(colorsLength);
    const averageColorsIndexesDiffs = new Uint16Array(colorsLength);
    const averageColorsLength = Math.floor(colorsLength * 0.25);
    const averageColor = new Uint32Array(colorChannels);
    function sortAverageColors(ai, bi) {
      return averageColorsIndexesDiffs[ai] - averageColorsIndexesDiffs[bi];
    }
    function getAverageColor(yAxis) {
      const colors = averageColorColorsData;
      const colorsIndexes = averageColorsIndexes;
      const colorsIndexesDiffs = averageColorsIndexesDiffs;
      for (let i = 0, yMax = image[yAxis], linesY = [2, 4, yMax - 4, yMax - 2], xStep = 16, offset = xStep * 2, xMax = image[yAxis === "height" ? "width" : "height"], colorsOffset = 0; i < linesY.length; i++) {
        for (let x = offset, y = linesY[i]; x <= xMax - offset; x += xStep) {
          if (yAxis === "height") {
            image.getPixel(x, y, colors, colorsOffset, false);
          } else {
            image.getPixel(y, x, colors, colorsOffset, false);
          }
          colorsOffset += colorChannels;
        }
      }
      for (let i = 0; i < colorsIndexes.length; i++) {
        colorsIndexes[i] = i;
      }
      const shrinkBy = Math.floor(averageColorsLength / 2);
      for (let includedColorsLength = colorsLength; includedColorsLength >= averageColorsLength; includedColorsLength -= shrinkBy) {
        for (let iRGB = 0; iRGB < colorChannels; iRGB++) {
          averageColor[iRGB] = 0;
          for (let i = 0; i < includedColorsLength; i++) {
            const colorsIndex = colorsIndexes[i];
            const colorOffset = colorsIndex * colorChannels + iRGB;
            averageColor[iRGB] += colors[colorOffset];
          }
          averageColor[iRGB] = Math.round(
            averageColor[iRGB] / includedColorsLength
          );
        }
        if (includedColorsLength - shrinkBy < averageColorsLength) break;
        for (let i = 0; i < colorsIndexesDiffs.length; i++) {
          const colorsIndex = colorsIndexes[i];
          if (i < includedColorsLength) {
            const pixelOffset = colorsIndex * colorChannels;
            const diff = Math.abs(averageColor[0] - colors[pixelOffset]) + Math.abs(averageColor[1] - colors[pixelOffset + 1]) + Math.abs(averageColor[2] - colors[pixelOffset + 2]);
            colorsIndexesDiffs[colorsIndex] = diff;
          } else {
            colorsIndexesDiffs[colorsIndex] += 1e3;
          }
        }
        colorsIndexes.sort(sortAverageColors);
      }
      return Array.from(averageColor);
    }
    function getHueDeviation(a, b) {
      return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    }
    function getBrightnessDeviation(a, b) {
      return Math.abs(a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
    }
    const maxBlackDeviation = {
      hue: 16,
      brightness: 8,
      sum: 20,
      score: 155 * 3 + 155 * 3
    };
    const maxDarkDeviation = {
      hue: 22,
      brightness: 22,
      sum: 36,
      score: 155 * 3 + 155 * 3
    };
    const maxLightDeviation = {
      hue: 32,
      brightness: 64,
      sum: 86,
      score: 255 * 3 + 255 * 3
    };
    function getMaxDeviationLimits(color) {
      const brightness = color[0] + color[1] + color[2];
      return brightness > 500 ? maxLightDeviation : brightness > 20 ? maxDarkDeviation : maxBlackDeviation;
    }
    function isColorWithinMaxDeviation(currentColor, referenceColor) {
      const hueDeviation = getHueDeviation(currentColor, referenceColor);
      const brightnessDeviation = getBrightnessDeviation(
        currentColor,
        referenceColor
      );
      const maxDeviation = getMaxDeviationLimits(referenceColor);
      return hueDeviation <= maxDeviation.hue && brightnessDeviation <= maxDeviation.brightness && hueDeviation + brightnessDeviation <= maxDeviation.sum;
    }
    const enhancedCertainty = true;
    const minDeviationScore = enhancedCertainty ? 0.25 : 0.4;
    const edgePointXRange = globalThis.BARDETECTION_EDGE_RANGE;
    const edgePointYRange = enhancedCertainty ? 8 : 16;
    const edgePointYCenter = 2 / edgePointYRange;
    const easeInOutQuad = (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    const getCertaintyColorData = new Uint8Array(4);
    const getCertainty = (pointX, pointY, yAxis, yDirection, color) => {
      const x = pointX - (enhancedCertainty ? edgePointXRange : 1);
      const y = pointY - edgePointYRange * 2 * (yDirection === 1 ? edgePointYCenter : 1 - edgePointYCenter);
      const xLength = 1 + (enhancedCertainty ? edgePointXRange * 2 : 0);
      const yLength = 1 + edgePointYRange * 2;
      let score = 0;
      for (let dx = 0; dx < xLength; dx += 2) {
        for (let dy = 0; dy < yLength; dy += 2) {
          const dy2 = yDirection === 1 ? dy : yLength - 1 - dy;
          let iColor = getCertaintyColorData;
          if (yAxis === "height") {
            image.getPixel(x + dx, y + dy2, iColor);
          } else {
            image.getPixel(y + dy2, x + dx, iColor);
          }
          if (iColor[3] === 0) iColor = color;
          const expectWithinDeviation = dy < Math.floor(1 + edgePointYRange * 2 * edgePointYCenter);
          if (!expectWithinDeviation) {
            const maxDeviation = getMaxDeviationLimits(color);
            const hueDeviation = getHueDeviation(iColor, color);
            const brightnessDeviation = getBrightnessDeviation(iColor, color);
            const deviationScore = Math.max(
              0,
              Math.min(
                1 - minDeviationScore,
                (hueDeviation + brightnessDeviation) / maxDeviation.score / 0.05
              )
            );
            score += minDeviationScore + deviationScore;
          } else {
            const within = isColorWithinMaxDeviation(iColor, color);
            if (within) score += 1;
          }
        }
      }
      const length = (1 + (xLength - 1) / 2) * (1 + (yLength - 1) / 2);
      const certainty = (score - length / 2) / (length / 2);
      return easeInOutQuad(certainty);
    };
    const largeStep = 4;
    const ignoreEdge = 2;
    const middleYOffset = 10;
    const minCertainty = 0.65;
    const maxCertaintyChecks = enhancedCertainty ? 3 : 5;
    const sureCertainty = enhancedCertainty ? 0.65 : 0.65;
    const getAverageLineColorRange = 9;
    const getAverageLineColorRangeOffset = (getAverageLineColorRange - 1) / 2;
    const getAverageLineColorData = new Uint8Array(4 * getAverageLineColorRange);
    function getAverageLineColor(x, y, yAxis, iColor) {
      const iColors = getAverageLineColorData;
      const range = getAverageLineColorRange;
      const rangeOffset = getAverageLineColorRangeOffset;
      for (let i = 0; i < range; i++) {
        const x2 = x + (i - rangeOffset) * 2;
        const iColorsOffset = i * 4;
        if (yAxis === "height") {
          image.getPixel(x2, y, iColors, iColorsOffset);
        } else {
          image.getPixel(y, x2, iColors, iColorsOffset);
        }
      }
      for (let i = 0; i < 4; i++) {
        let sum = 0;
        for (let j = 0; j < range; j++) {
          sum += iColors[j * 4 + i];
        }
        iColor[i] = Math.round(sum / range);
      }
    }
    const detectEdgesColorData = new Uint8Array(4);
    function detectEdges(linesX, color, yAxis) {
      const maxY = image[yAxis];
      const middleY = maxY / 2;
      const topEdges = [];
      const bottomEdges = [];
      const iColor = detectEdgesColorData;
      for (const x of linesX) {
        let step = largeStep;
        let wasDeviating = false;
        let wasUncertain = false;
        let mostCertainEdge;
        let detectedEdges = 0;
        for (let y = ignoreEdge; y < maxY; y += step) {
          if (wasUncertain) {
            wasUncertain = false;
            step = 1;
          }
          getAverageLineColor(x, y, yAxis, iColor);
          const limitNotReached = y < middleY - middleYOffset - 1;
          if (!limitNotReached || detectedEdges > maxCertaintyChecks) {
            if (mostCertainEdge?.certainty > minCertainty) {
              topEdges.find(
                (edge) => x === edge.xIndex && mostCertainEdge.yIndex === edge.yIndex
              ).deviates = false;
            } else {
              topEdges.push({
                xIndex: x,
                yIndex: 0,
                certainty: 0,
                deviates: true
              });
            }
            break;
          }
          const isDeviating = !isColorWithinMaxDeviation(iColor, color);
          if (limitNotReached && wasDeviating && !isDeviating) {
            wasDeviating = false;
            continue;
          }
          if (limitNotReached && wasDeviating === isDeviating) continue;
          if (y !== 0 && step === largeStep) {
            y = Math.max(-1, y - 1 * step);
            step = Math.ceil(1, Math.floor(step / 2));
            continue;
          }
          const certainty = getCertainty(x, y / 1, yAxis, 1, color, linesX);
          detectedEdges++;
          if (limitNotReached && certainty < sureCertainty) {
            wasUncertain = true;
            wasDeviating = true;
            if (!(mostCertainEdge?.certainty >= certainty)) {
              mostCertainEdge = {
                // i,
                yIndex: y,
                certainty
              };
            }
            topEdges.push({
              xIndex: x,
              yIndex: y,
              certainty,
              deviates: true
            });
            continue;
          }
          topEdges.push({
            xIndex: x,
            yIndex: y,
            certainty
          });
          break;
        }
        step = largeStep;
        wasDeviating = false;
        wasUncertain = false;
        mostCertainEdge = void 0;
        detectedEdges = 0;
        for (let y = maxY - 1 + ignoreEdge; y >= 0; y -= step) {
          if (wasUncertain) {
            wasUncertain = false;
            step = 1;
          }
          getAverageLineColor(x, y, yAxis, iColor);
          const limitNotReached = y > middleY + middleYOffset;
          if (!limitNotReached || detectedEdges > maxCertaintyChecks) {
            if (mostCertainEdge?.certainty > minCertainty) {
              bottomEdges.find(
                (edge) => x === edge.xIndex && mostCertainEdge.yIndex === edge.yIndex
              ).deviates = false;
            } else {
              bottomEdges.push({
                xIndex: x,
                yIndex: 0,
                certainty: 0,
                deviates: true
              });
            }
            break;
          }
          const isDeviating = !isColorWithinMaxDeviation(iColor, color);
          if (limitNotReached && wasDeviating && !isDeviating) {
            wasDeviating = false;
            continue;
          }
          if (limitNotReached && wasDeviating === isDeviating) continue;
          if (y !== maxY - 1 && step === largeStep) {
            y = Math.min(maxY - 1, y + step);
            step = Math.ceil(1, Math.floor(step / 2));
            continue;
          }
          const certainty = getCertainty(x, y, yAxis, -1, color, linesX);
          detectedEdges++;
          if (limitNotReached && certainty < sureCertainty) {
            wasUncertain = true;
            wasDeviating = true;
            if (!(mostCertainEdge?.certainty >= certainty)) {
              mostCertainEdge = {
                yIndex: maxY - y,
                // i,
                certainty
              };
            }
            bottomEdges.push({
              xIndex: x,
              yIndex: maxY - y,
              certainty,
              deviates: true
            });
            continue;
          }
          bottomEdges.push({
            xIndex: x,
            yIndex: maxY - y,
            certainty
          });
          break;
        }
      }
      return { topEdges, bottomEdges };
    }
    const reduceAverageSize = (edges) => edges.reduce((sum, edge) => sum + edge.yIndex, 0) / edges.length;
    function getExceedsDeviationLimit(edges, topEdges, bottomEdges, linesX, maxSize, scale, allowedAnomaliesPercentage, allowedUnevenBarsPercentage) {
      if (!topEdges.filter((e) => !e.deviates).length || !bottomEdges.filter((e) => !e.deviates).length) {
        return true;
      }
      const threshold = linesX.length * 2 * (1 - (allowedAnomaliesPercentage - 10) / 100);
      if (edges.filter((e) => !e.deviates).length < threshold) {
        return true;
      }
      while (edges.filter((e) => !e.deviates).length > threshold) {
        const nonDeviatingEdges = edges.filter((e) => !e.deviates);
        const averageSize = reduceAverageSize(nonDeviatingEdges);
        nonDeviatingEdges.sort(sortSizes(averageSize));
        const deviatingEdge = nonDeviatingEdges[nonDeviatingEdges.length - 1];
        deviatingEdge.deviates = true;
      }
      const maxAllowedSideDeviation = maxSize * (8e-3 * scale);
      const nonDeviatingTopEdges = topEdges.filter(
        (e) => !e.deviates && !e.deviatesTop
      );
      const maxTopDeviation = Math.abs(
        Math.max(...nonDeviatingTopEdges.map((e) => e.yIndex)) - Math.min(...nonDeviatingTopEdges.map((e) => e.yIndex))
      );
      const topDeviationIsAllowed = maxTopDeviation <= maxAllowedSideDeviation;
      const nonDeviatingBottomEdges = bottomEdges.filter(
        (e) => !e.deviates && !e.deviatesBottom
      );
      const maxBottomDeviation = Math.abs(
        Math.max(...nonDeviatingBottomEdges.map((e) => e.yIndex)) - Math.min(...nonDeviatingBottomEdges.map((e) => e.yIndex))
      );
      const bottomDeviationIsAllowed = maxBottomDeviation <= maxAllowedSideDeviation;
      if (!topDeviationIsAllowed && !bottomDeviationIsAllowed) {
        return true;
      }
      const averageTopSize = reduceAverageSize(nonDeviatingTopEdges);
      const averageBottomSize = reduceAverageSize(nonDeviatingBottomEdges);
      const sidesDeviation = Math.abs(averageTopSize - averageBottomSize);
      const maxAllowedDeviation = maxSize * (3e-3 + allowedUnevenBarsPercentage * 8e-4) * scale;
      const minMaxAllowedSideDeviation = maxSize * (0.016 * scale);
      let maxAllowedSidesDeviation = maxAllowedDeviation;
      if (averageTopSize < minMaxAllowedSideDeviation || averageBottomSize < minMaxAllowedSideDeviation) {
        maxAllowedSidesDeviation = 2;
      } else {
      }
      if (sidesDeviation > maxAllowedSidesDeviation) {
        return true;
      }
      const nonDeviatingEdgeSizes = edges.filter((e) => !e.deviates).map((e) => e.yIndex);
      const maxDeviation = Math.abs(
        Math.max(...nonDeviatingEdgeSizes) - Math.min(...nonDeviatingEdgeSizes)
      );
      if (maxDeviation > maxAllowedDeviation) {
        return true;
      }
    }
    function getPercentage(exceedsDeviationLimit, maxSize, scale, edges, linesX, currentPercentage = 0, offsetPercentage = 0) {
      const lowerSizeThreshold = maxSize * ((currentPercentage - 2) / 100);
      const baseOffsetPercentage = 0.3 * ((1 + scale) / 2);
      let certainty = 1;
      let size;
      if (exceedsDeviationLimit) {
        const uncertainLowerEdges = edges.filter(
          (e) => e.certainty > 0.02 && e.yIndex < lowerSizeThreshold
        );
        if (uncertainLowerEdges.length / (linesX.length * 2) < 0.3)
          return {
            percentage: void 0,
            certainty: 0
          };
        certainty = uncertainLowerEdges.reduce((sum, edge) => sum + edge.certainty, 0) / uncertainLowerEdges.length;
        const lowestEdge = uncertainLowerEdges.sort(
          (a, b) => a.yIndex - b.yIndex
        )[0];
        size = lowestEdge.yIndex;
        if (size < 0) {
          size = 0;
        } else {
          size += maxSize * (offsetPercentage / 100);
        }
      } else {
        const sortedEdges = edges.filter((e) => !e.deviates).sort(sortSizes(0));
        size = reduceAverageSize(
          sortedEdges.slice(Math.floor(sortedEdges.length / 2))
        );
        if (size < 0) {
          size = 0;
        } else {
          size += maxSize * ((baseOffsetPercentage + offsetPercentage) / 100);
        }
      }
      let percentage = Math.round(size / maxSize * 1e4) / 100;
      const maxPercentage = 38;
      percentage = Math.min(percentage, maxPercentage);
      return {
        percentage,
        certainty
      };
    }
    const workerDetectBarSizeLinesX = new Uint16Array(5);
    try {
      const workerDetectBarSize = (id, xLength, yAxis, scale, detectColored, offsetPercentage, currentPercentage, allowedAnomaliesPercentage, allowedUnevenBarsPercentage, xOffset) => {
        const partSizeBorderMultiplier = -0.1 + 2 * allowedAnomaliesPercentage / 100;
        const partSize = Math.floor(
          canvas[xLength] / (scanlinesAmount + partSizeBorderMultiplier * 2)
        );
        const linesX = workerDetectBarSizeLinesX;
        let linesXIndex = 0;
        for (let index = Math.ceil(partSize / 2) - 1 + partSizeBorderMultiplier * partSize; index < canvas[xLength] - partSizeBorderMultiplier * partSize; index += partSize) {
          const xIndex = Math.min(
            Math.max(
              0,
              Math.round(
                index + Math.round(xOffset * (partSize / 2) - partSize / 4)
              )
            ),
            canvas[xLength] - 1
          );
          linesX[linesXIndex] = xIndex;
          linesXIndex++;
        }
        const color = getAverageColor(yAxis);
        if (!detectColored && (color[0] + color[1] + color[2] > 16 || Math.abs(color[0] - color[1]) > 3 || Math.abs(color[1] - color[2]) > 3 || Math.abs(color[2] - color[0]) > 3)) {
          const topEdges2 = linesX.map((x) => ({
            xIndex: x,
            yIndex: 0,
            deviates: true
          }));
          const bottomEdges2 = linesX.map((x) => ({
            xIndex: x,
            yIndex: 0,
            deviates: true
          }));
          return {
            percentage: 0,
            topEdges: topEdges2,
            bottomEdges: bottomEdges2,
            color
          };
        }
        const { topEdges, bottomEdges } = detectEdges(linesX, color, yAxis);
        const maxSize = image[yAxis];
        const edges = topEdges.concat(bottomEdges);
        const exceedsDeviationLimit = getExceedsDeviationLimit(
          edges,
          topEdges,
          bottomEdges,
          linesX,
          maxSize,
          scale,
          allowedAnomaliesPercentage,
          allowedUnevenBarsPercentage
        );
        const { percentage, certainty } = getPercentage(
          exceedsDeviationLimit,
          maxSize,
          scale,
          edges,
          linesX,
          currentPercentage,
          offsetPercentage
        );
        if (!(percentage < currentPercentage) && edges.filter((edge) => !edge.deviates).length / (linesX.length * 2) < (100 - allowedAnomaliesPercentage) / 100) {
          for (const edge of topEdges) {
            edge.deviates = true;
          }
          for (const edge of bottomEdges) {
            edge.deviates = true;
          }
          return {
            topEdges,
            bottomEdges,
            color
          };
        }
        return {
          percentage,
          certainty,
          topEdges,
          bottomEdges,
          color
        };
      };
      const createContext = () => {
        ctx = canvas.getContext("2d", {
          // alpha: false, // Decreases performance on some platforms
          desynchronized: true,
          willReadFrequently: true
        });
        ctx.imageSmoothingEnabled = false;
      };
      const createCanvas = (width, height) => {
        canvas = new OffscreenCanvas(width, height);
        canvas.addEventListener("contextlost", () => {
          try {
            canvas.width = 1;
            canvas.height = 1;
          } catch (ex) {
            postError(ex);
          }
        });
        canvas.addEventListener("contextrestored", () => {
          try {
            canvas.width = 1;
            canvas.height = 1;
          } catch (ex) {
            postError(ex);
          }
        });
        canvasIsCreatedInWorker = true;
        createContext();
      };
      this.onmessage = async (e) => {
        if (e.data === false) {
          this.postMessage(false);
          return;
        }
        const id = e.data.id;
        globalRunId = id;
        try {
          if (e.data.type === "cancellation") {
            globalXOffsetIndex = 0;
            return;
          }
          if (e.data.type === "clear") {
            globalXOffsetIndex = 0;
            if (canvas && canvasIsCreatedInWorker && canvas.width !== 1 && canvas.height !== 1)
              createCanvas(1, 1);
            return;
          }
          const {
            detectColored,
            detectHorizontal,
            detectVertical,
            offsetPercentage,
            currentHorizontalPercentage,
            currentVerticalPercentage,
            // ratio
            allowedAnomaliesPercentage,
            allowedUnevenBarsPercentage,
            canvasInfo,
            xOffsetSize
          } = e.data;
          if (canvasInfo.bitmap) {
            const bitmap = canvasInfo.bitmap;
            if (!canvas) {
              createCanvas(512, 512);
            } else if (canvas.width !== 512 || canvas.height !== 512) {
              canvas.width = 512;
              canvas.height = 512;
              createContext();
            }
            ctx.drawImage(bitmap, 0, 0, 512, 512);
            bitmap.close();
          } else {
            canvas = canvasInfo.canvas;
            canvasIsCreatedInWorker = false;
            ctx = canvasInfo.ctx;
          }
          image.imageData = ctx.getImageData(0, 0, 512, 512);
          globalXOffsetIndex++;
          if (globalXOffsetIndex >= xOffsetSize) globalXOffsetIndex = 0;
          const xOffset = xOffsetSize === 1 ? 0.5 : xOffsetSize === 2 ? globalXOffsetIndex : (Math.ceil(globalXOffsetIndex / 2) + globalXOffsetIndex % 2) / (xOffsetSize - 1);
          let horizontalBarSizeInfo = detectHorizontal ? await workerDetectBarSize(
            id,
            "width",
            "height",
            1,
            detectColored,
            offsetPercentage,
            currentHorizontalPercentage,
            allowedAnomaliesPercentage,
            allowedUnevenBarsPercentage,
            xOffset
          ) : void 0;
          let verticalBarSizeInfo = detectVertical ? await workerDetectBarSize(
            id,
            "height",
            "width",
            1,
            detectColored,
            offsetPercentage,
            currentVerticalPercentage,
            allowedAnomaliesPercentage,
            allowedUnevenBarsPercentage,
            xOffset
          ) : void 0;
          if (id !== globalRunId) {
            return;
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          this.postMessage({
            id,
            horizontalBarSizeInfo,
            verticalBarSizeInfo
          });
        } catch (ex) {
          if (id === globalRunId) {
            ctx?.clearRect?.(0, 0, canvas?.width ?? 0, canvas?.height ?? 0);
          }
          this.postMessage({
            id,
            error: ex
          });
        }
      };
    } catch (ex) {
      postError(ex);
    }
  };
  var BarDetection = class {
    worker;
    runId = 0;
    canvas;
    ctx;
    catchedDetectBarSizeError = false;
    changes = [];
    history = {
      horizontal: [],
      vertical: []
    };
    current = {
      horizontal: void 0,
      vertical: void 0
    };
    constructor(ambientlight) {
      this.ambientlight = ambientlight;
    }
    reset = () => {
      this.clear();
      this.history = {
        horizontal: [],
        vertical: []
      };
      this.current = {
        horizontal: void 0,
        vertical: void 0
      };
      this.changes = [];
    };
    clear = () => {
      this.runId++;
      if (this.worker) {
        this.worker.postMessage({
          id: this.runId,
          type: "clear"
        });
      }
      this.running = false;
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = void 0;
      }
    };
    cancel = () => {
      this.runId++;
      if (this.worker) {
        this.worker.postMessage({
          id: this.runId,
          type: "cancellation"
        });
      }
      this.running = false;
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = void 0;
      }
    };
    detect = async (buffer, detectColored, offsetPercentage, detectHorizontal, currentHorizontalPercentage, detectVertical, currentVerticalPercentage, ratio, allowedToTransfer, averageHistorySize, allowedAnomaliesPercentage, allowedUnevenBarsPercentage, callback) => {
      if (this.running) {
        return;
      }
      this.runId++;
      const runId = this.runId;
      this.running = true;
      if (!this.worker) {
        this.worker = await workerFromCode(workerCode);
        const stack = new Error().stack;
        this.worker.onmessage = (e) => {
          if (this.onWorkerMessageListener) {
            return this.onWorkerMessageListener(e);
          }
          if (e.data.id !== -1) {
            return;
          }
          if (e.data.error) {
            appendErrorStack(stack, e.data.error);
            SentryReporter.captureException(e.data.error);
          }
        };
        this.worker.onerror = (err) => {
          if (!(err instanceof Error)) {
            const details = err;
            err = new Error(
              `bar-detection-worker.js: ${err.message ?? "Unknown error"}`
            );
            err.details = details;
          }
          if (this.onWorkerRejectListener) {
            return this.onWorkerRejectListener(err);
          }
          SentryReporter.captureException(err);
        };
      }
      if (this.history.horizontal.length === 0)
        currentHorizontalPercentage = void 0;
      if (this.history.vertical.length === 0)
        currentVerticalPercentage = void 0;
      requestIdleCallback(
        async function detectIdleCallback() {
          await this.idleHandler(
            runId,
            buffer,
            detectColored,
            offsetPercentage,
            detectHorizontal,
            currentHorizontalPercentage,
            detectVertical,
            currentVerticalPercentage,
            ratio,
            allowedToTransfer,
            averageHistorySize,
            allowedAnomaliesPercentage,
            allowedUnevenBarsPercentage,
            callback
          );
        }.bind(this),
        { timeout: 1 },
        true
      );
    };
    maxDivergencePercentage = 0.75;
    groupByPercentage = 0.5;
    // Todo: with 40% certainty + colors: Fix 11 11 11 -> 0 -> 11 -> 0 0 0 at https://www.youtube.com/watch?v=bPNL6nmc-pA&t=46s
    averagePercentage(barSizeInfo = {}, currentInfo = {}, minPercentage, history, averageHistorySize) {
      let { percentage, color, certainty } = barSizeInfo;
      let { percentage: currentPercentage, color: currentColor } = currentInfo;
      let colorChanged = false;
      if (currentColor && color) {
        if (
          // [...history.map(info => info.color), color].every(color => (
          //   Math.abs(currentColor[0] - color[0]) +
          //   Math.abs(currentColor[1] - color[1]) +
          //   Math.abs(currentColor[2] - color[2])
          // ) > 50)
          Math.abs(currentColor[0] - color[0]) + Math.abs(currentColor[1] - color[1]) + Math.abs(currentColor[2] - color[2]) > 50
        ) {
          if (percentage === void 0 || certainty < 0.8) percentage = 0;
          certainty = 1;
          colorChanged = true;
        }
      }
      if (percentage === void 0) {
        if (!history.length && !currentPercentage) {
          history.push({
            percentage: 0,
            certainty: 1,
            color
          });
          return 0;
        }
        return;
      }
      const detectedPercentage = percentage;
      let percentages = [
        ...history,
        {
          percentage: detectedPercentage,
          certainty,
          color
        }
      ];
      for (const info of percentages) {
        info.occurrences = percentages.filter(
          ({ percentage: percentage2 }) => Math.abs(info.percentage - percentage2) < this.groupByPercentage
        ).length;
      }
      if (!colorChanged) {
        percentage = parseFloat(
          percentages.reduce((a, b) => a.occurrences > b.occurrences ? a : b).percentage
        );
        if (percentage !== currentPercentage && // Math.abs(
        (percentages.find((info) => info.percentage === percentage)?.occurrences ?? 0) - (percentages.find((info) => info.percentage === currentPercentage)?.occurrences ?? 0) <= // )
        history.length / 2) {
          percentage = currentPercentage;
        }
      }
      let adjustment = percentage - currentPercentage;
      if (percentage !== 0 && adjustment > -this.maxDivergencePercentage && adjustment <= 0) {
        adjustment = detectedPercentage - currentPercentage;
        if (adjustment > -this.maxDivergencePercentage && adjustment <= 0) {
          percentage = void 0;
        } else {
          percentage = currentPercentage;
        }
      }
      const ignoreRecurringLowerPercentage = percentage < currentPercentage && history.some(
        ({ percentage: previousPercentage }) => Math.abs(currentPercentage - previousPercentage) < this.groupByPercentage
      ) && history.some(
        ({ percentage: previousPercentage }) => Math.abs(detectedPercentage - previousPercentage) < this.groupByPercentage
      );
      if (colorChanged && percentage !== currentPercentage) {
        const nonDeviatingPercentages = history.filter(
          (info) => Math.abs(info.percentage - percentage) < this.maxDivergencePercentage
        );
        if (history.length !== nonDeviatingPercentages.length) {
          history.splice(0, history.length);
          history.push(...nonDeviatingPercentages);
        }
      }
      history.push({ percentage: detectedPercentage, certainty, color });
      if (history.length > averageHistorySize)
        history.splice(0, history.length - averageHistorySize);
      if (ignoreRecurringLowerPercentage) {
        return;
      }
      return percentage < minPercentage ? 0 : percentage;
    }
    idleHandler = async (runId, buffer, detectColored, offsetPercentage, detectHorizontal, currentHorizontalPercentage, detectVertical, currentVerticalPercentage, ratio, allowedToTransfer, averageHistorySize, allowedAnomaliesPercentage, allowedUnevenBarsPercentage, callback) => {
      if (this.runId !== runId) return;
      let canvasInfo;
      let bufferCtx;
      try {
        const start = performance.now();
        if (this.worker.isFallbackWorker || !allowedToTransfer || !buffer.transferToImageBitmap || !buffer.getContext) {
          if (!this.canvas) {
            this.canvas = new SafeOffscreenCanvas(
              512,
              512
              // Math.min(buffer.videoWidth || buffer.width || 512, 512),
              // Math.min(buffer.videoHeight || buffer.height || 512, 512)
            );
            this.ctx = void 0;
          }
          if (!this.ctx || this.ctx?.isContextLost && this.ctx.isContextLost()) {
            this.ctx = this.canvas.getContext("2d", {
              // alpha: false, // Decreases performance on some platforms
              desynchronized: true
            });
            this.ctx.imageSmoothingEnabled = true;
          }
          this.ctx.drawImage(buffer, 0, 0, this.canvas.width, this.canvas.height);
          canvasInfo = this.worker.isFallbackWorker || !this.canvas.transferToImageBitmap ? {
            canvas: this.canvas,
            ctx: this.ctx
          } : {
            bitmap: this.canvas.transferToImageBitmap()
          };
        } else {
          bufferCtx = buffer.getContext("2d");
          if (bufferCtx instanceof Promise) bufferCtx = await bufferCtx;
          if (bufferCtx && (!bufferCtx.isContextLost || !bufferCtx.isContextLost())) {
            canvasInfo = {
              bitmap: buffer.transferToImageBitmap()
            };
          }
        }
        if (this.runId !== runId) {
          if (canvasInfo?.bitmap) {
            canvasInfo.bitmap.close();
          }
          return;
        }
        if (!canvasInfo) {
          this.running = false;
          return;
        }
        this.ambientlight.stats.updateBarDetectionImage(
          canvasInfo.bitmap ?? canvasInfo.canvas
        );
        const stack = new Error().stack;
        const onMessagePromise = new Promise(
          function onMessagePromise2(resolve, reject) {
            this.onWorkerRejectListener = (err) => reject(err);
            this.onWorkerMessageListener = async (e) => {
              try {
                if (e.data.id !== this.runId) {
                  resolve();
                  return;
                }
                if (e.data.error) {
                  const error = e.data.error;
                  error.stack = error.stack?.replace(
                    /blob:.+?:\/.+?:/g,
                    "extension://scripts/bar-detection-worker.js:"
                  );
                  appendErrorStack(stack, error);
                  throw error;
                }
                const minPercentage = 1.25 + offsetPercentage;
                const { horizontalBarSizeInfo = {}, verticalBarSizeInfo = {} } = e.data;
                const firstDetection = this.history.horizontal.length === 0 && this.history.vertical.length === 0;
                let horizontalPercentage = this.averagePercentage(
                  horizontalBarSizeInfo,
                  this.current.horizontal,
                  minPercentage,
                  this.history.horizontal,
                  averageHistorySize
                );
                let verticalPercentage = this.averagePercentage(
                  verticalBarSizeInfo,
                  this.current.vertical,
                  minPercentage,
                  this.history.vertical,
                  averageHistorySize
                );
                let barsFound = horizontalPercentage !== void 0 || verticalPercentage !== void 0;
                await this.ambientlight.stats.updateBarDetectionResult(
                  barsFound,
                  horizontalBarSizeInfo,
                  verticalBarSizeInfo,
                  horizontalPercentage ?? currentHorizontalPercentage ?? 0,
                  verticalPercentage ?? currentVerticalPercentage ?? 0
                );
                if (e.data.id !== this.runId) {
                  resolve();
                  return;
                }
                if (firstDetection) {
                  if (horizontalPercentage === void 0)
                    horizontalPercentage = 0;
                  if (verticalPercentage === void 0) verticalPercentage = 0;
                  barsFound = true;
                }
                const barsChanged = barsFound && horizontalPercentage !== void 0 && horizontalPercentage !== currentHorizontalPercentage || verticalPercentage !== void 0 && verticalPercentage !== currentVerticalPercentage;
                const detectedLargeChange = horizontalBarSizeInfo.percentage > minPercentage && Math.abs(
                  horizontalBarSizeInfo.percentage - (currentHorizontalPercentage || 0)
                ) > 0.5 || verticalBarSizeInfo.percentage > minPercentage && Math.abs(
                  verticalBarSizeInfo.percentage - (currentVerticalPercentage || 0)
                ) > 0.5;
                if (barsChanged || detectedLargeChange) {
                  const now2 = performance.now();
                  if (barsChanged || this.changes[this.changes.length - 1] < now2 - 3e3) {
                    this.changes.push(now2);
                  }
                }
                if (horizontalPercentage !== void 0) {
                  this.current.horizontal = {
                    percentage: horizontalPercentage,
                    color: horizontalBarSizeInfo.color
                    // Can desync with percentage, return from averagePercentage as well?
                  };
                }
                if (verticalPercentage !== void 0) {
                  this.current.vertical = {
                    percentage: verticalPercentage,
                    color: verticalBarSizeInfo.color
                    // Can desync with percentage, return from averagePercentage as well?
                  };
                }
                if (barsChanged) {
                  callback(horizontalPercentage, verticalPercentage);
                }
                resolve();
              } catch (ex) {
                reject(ex);
              }
            };
          }.bind(this)
        );
        this.worker.postMessage(
          {
            id: runId,
            canvasInfo,
            detectColored,
            offsetPercentage,
            detectHorizontal,
            currentHorizontalPercentage,
            detectVertical,
            currentVerticalPercentage,
            ratio,
            allowedAnomaliesPercentage,
            allowedUnevenBarsPercentage,
            xOffsetSize: averageHistorySize
          },
          canvasInfo.bitmap ? [canvasInfo.bitmap] : void 0
        );
        await onMessagePromise;
        if (this.runId !== runId) return;
        const now = performance.now();
        const duration = now - start;
        this.ambientlight.stats.addBarDetectionDuration(duration);
        if (this.changes.length > 1) {
          const minuteAgo = performance.now() - 6e4;
          this.changes = this.changes.filter((change) => change > minuteAgo);
        } else if (!this.changes.length) {
          this.changes.push(now - 3001);
        }
        let minThrottle;
        const lastChange = this.changes[this.changes.length - 1];
        if (this.changes.length >= 5) {
          minThrottle = lastChange + 6e4 < now ? 1e3 : lastChange + 8e3 < now ? 500 : 0;
        } else {
          minThrottle = lastChange + 15e3 < now ? 1e3 : lastChange + 3e3 < now ? 500 : 0;
        }
        const throttle = Math.max(
          minThrottle,
          Math.min(5e3, Math.pow(duration, 1.2) - 250)
        );
        this.ambientlight.stats.updateBarDetectionInfo(
          throttle,
          this.changes[this.changes.length - 1]
        );
        this.timeout = setTimeout(
          wrapErrorHandler(() => {
            this.timeout = void 0;
            if (this.runId !== runId) return;
            this.running = false;
          }),
          throttle
        );
      } catch (ex) {
        const isKnownError = ex.message?.includes("ImageBitmap construction failed") || // Chromium
        ex.name === "DataCloneError";
        if (!isKnownError) {
          ex.details = {
            ...ex.details ? { details: ex.details } : {},
            detectColored,
            offsetPercentage,
            detectHorizontal,
            currentHorizontalPercentage,
            detectVertical,
            currentVerticalPercentage,
            ratio,
            allowedToTransfer,
            buffer: buffer ? {
              width: buffer.width,
              height: buffer.height,
              ctx: buffer.ctx?.constructor?.name,
              type: buffer.constructor?.name
            } : void 0,
            bufferCtx: bufferCtx?.constructor?.name,
            canvasInfo: canvasInfo ? {
              canvas: canvasInfo?.canvas ? {
                width: canvasInfo.canvas.width,
                height: canvasInfo.canvas.height,
                type: canvasInfo.canvas.constructor?.name
              } : void 0,
              ctx: canvasInfo.ctx?.constructor?.name,
              bitmap: canvasInfo?.bitmap ? {
                width: canvasInfo.bitmap.width,
                height: canvasInfo.bitmap.height,
                type: canvasInfo.bitmap.constructor?.name
              } : void 0
            } : void 0
          };
        }
        if (this.runId === runId) {
          if (canvasInfo?.bitmap) {
            canvasInfo.bitmap.close();
          }
          this.running = false;
        }
        if (this.catchedDetectBarSizeError || isKnownError) return;
        this.catchedDetectBarSizeError = true;
        throw ex;
      }
    };
  };

  // src/utils.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/utils.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */

  // src/settings-config.js
  /*! youtube-ambilight (https://github.com/WesselKroos/youtube-ambilight) src/scripts/libs/settings-config.js
   * at commit 18d17188e5562e5ee913f005192d30c9a60be078. Copied unchanged.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  var SettingsConfig = [
    {
      type: "section",
      label: "Settings",
      name: "sectionSettingsCollapsed",
      default: true
    },
    {
      name: "advancedSettings",
      label: "Advanced",
      type: "checkbox",
      default: false
    },
    {
      type: "section",
      label: "Stats",
      name: "sectionStatsCollapsed",
      default: true,
      advanced: true
    },
    {
      name: "showFPS",
      label: "Framerates",
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "showFrametimes",
      label: "Frametimes graph",
      description: "Uses: CPU power",
      questionMark: {
        title: "The measured display framerate is not a reflection of the real performance.\nBecause the measurement uses an extra percentage of CPU usage.\nHowever, this statistic could be helpful to debug other issues."
      },
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "showResolutions",
      label: "Resolutions & drawtimes",
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "showBarDetectionStats",
      label: "Bar detection",
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      type: "section",
      label: "Quality",
      name: "sectionQualityPerformanceCollapsed",
      default: true
    },
    {
      name: "webGL",
      label: "WebGL renderer (uses less power)",
      description: "Changing this reloads the webpage",
      type: "checkbox",
      default: true
    },
    {
      name: "resolution",
      label: "Resolution",
      type: "list",
      default: 100,
      unit: "%",
      valuePoints: (() => {
        const points = [6.25];
        while (points[points.length - 1] < 400) {
          points.push(points[points.length - 1] * 2);
        }
        return points;
      })(),
      manualinput: false
    },
    {
      name: "framerateLimit",
      label: "Limit framerate (per second)",
      type: "list",
      default: 60,
      min: 0,
      max: 60,
      step: 1
    },
    {
      name: "frameSync",
      label: "Synchronization",
      questionMark: {
        title: "How much energy will be spent on sychronising ambient light frames with video frames.\n\nDecoded framerate: Lowest CPU & GPU usage.\nMight result in dropped and delayed frames.\n\nDisplay framerate: Highest CPU & GPU usage.\nMight still result in delayed frames on high refreshrate monitors (120hz and higher) and higher than 1080p videos.\n\nVideo framerate: Lowest CPU & GPU usage.\nUses the newest browser technology to always keep the frames in sync."
      },
      type: "list",
      default: 2,
      min: 0,
      max: 2,
      step: 1,
      snapPoints: [
        { value: 0, label: "Decoded" },
        { value: 1, label: "Display" },
        { value: 2, label: "Video" }
      ],
      manualinput: false,
      advanced: true,
      experimental: true
    },
    {
      name: "energySaver",
      label: "Save energy on static videos",
      questionMark: {
        title: "Limits the framerate on videos with an (almost) static image\n\nStill image: 1 frame per 5 seconds\nSmall movements: 1 frame per second"
      },
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "prioritizePageLoadSpeed",
      label: "Prioritize page load speed",
      description: "Loads the ambient light after the page has loaded",
      type: "checkbox",
      default: true
    },
    {
      name: "layoutPerformanceImprovements",
      label: "YouTube responsiveness fixes",
      description: "Improves the responsiveness of the webpage",
      questionMark: {
        title: `Some of the improvements on the /watch page include:
- Faster webpage resizing and scrolling (Most noticeable after you've loaded in more than 100 comments)
- Faster loadingtimes for comments and/or related videos
- Smoother timeline scrubbing (Most noticeable after you've loaded in more than 100 comments or with a livestream chat window open)
- Smoother livestream chat scrolling (and new messages will be appended quicker to the chat)
- Smoother playlist scrolling (Most noticeable in a playlist with more than 25 videos)
- Smoother dragging/re-ordering videos in a playlist (Most noticeable in a playlist with more than 25 videos)`
      },
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      name: "debandingBlendMode",
      label: "Optimize debanding for",
      questionMark: {
        title: `The normal blend mode is usefull to fix banding in dark colors on LCD's.
But on OLED's it's better to use the "overlay" blend mode to retain pure blacks.`
      },
      type: "list",
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      snapPoints: [
        { value: 0, label: "LCD (normal)" },
        { value: 1, label: "OLED (overlay)" }
      ],
      manualinput: false,
      advanced: true,
      new: true
    },
    {
      type: "section",
      label: "Page header",
      name: "sectionOtherPageHeaderCollapsed",
      default: true
    },
    {
      name: "headerShadowSize",
      label: "Shadows size",
      type: "list",
      default: 0,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "headerShadowOpacity",
      label: "Shadows opacity",
      type: "list",
      default: 30,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "headerImagesOpacity",
      label: "Images opacity",
      type: "list",
      default: 100,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "headerFillOpacity",
      label: "Background opacity",
      description: "Only applies when scrolled down",
      type: "list",
      default: 100,
      min: -100,
      max: 100,
      step: 0.1,
      advanced: true
    },
    {
      type: "section",
      label: "Page content",
      name: "sectionOtherPageContentCollapsed",
      default: true
    },
    {
      name: "surroundingContentShadowSize",
      label: "Shadows size",
      type: "list",
      default: 15,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "surroundingContentShadowOpacity",
      label: "Shadows opacity",
      type: "list",
      default: 30,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "surroundingContentTextAndBtnOnly",
      label: "Shadows on texts and buttons only",
      description: "Decreases scrolling & video stutter",
      type: "checkbox",
      advanced: true,
      default: true
    },
    {
      name: "surroundingContentImagesOpacity",
      label: "Images opacity",
      type: "list",
      default: 100,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "surroundingContentFillOpacity",
      label: "Buttons & boxes background opacity",
      type: "list",
      default: 10,
      min: -100,
      max: 100,
      step: 0.1
    },
    {
      name: "pageBackgroundGreyness",
      label: "Background greyness",
      type: "list",
      default: 0,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "immersiveTheaterView",
      label: "Hide everything in theater mode",
      type: "checkbox",
      default: false
    },
    {
      name: "relatedScrollbar",
      label: "Related videos as scrollable list",
      description: "Also improves scrolling through comments",
      type: "checkbox",
      advanced: true,
      default: false
    },
    {
      name: "hideScrollbar",
      label: "Hide scrollbar",
      type: "checkbox",
      advanced: true,
      default: false
    },
    {
      type: "section",
      label: "Video",
      name: "sectionVideoResizingCollapsed",
      default: true
    },
    {
      name: "videoScale.SMALL",
      label: "Size (in small view)",
      type: "list",
      default: 100,
      min: 25,
      max: 200,
      step: 0.1,
      new: true
    },
    {
      name: "videoScale.THEATER",
      label: "Size (in theater view)",
      type: "list",
      default: 100,
      min: 25,
      max: 200,
      step: 0.1,
      new: true
    },
    {
      name: "videoScale.FULLSCREEN",
      label: "Size (in fullscreen)",
      type: "list",
      default: 100,
      min: 25,
      max: 200,
      step: 0.1,
      new: true
    },
    {
      name: "videoShadowSize",
      label: "Shadow size",
      type: "list",
      default: 0,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "videoShadowOpacity",
      label: "Shadow opacity",
      type: "list",
      default: 50,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "videoDebandingStrength",
      label: "Debanding (noise)",
      questionMark: {
        title: 'Click for more information about debanding (noise /dithering).\nTip: Change the "Quality > Optimize debanding for" setting to "OLED" to retain pure blacks on OLED displays.',
        href: "https://www.lifewire.com/what-is-dithering-4686105"
      },
      type: "list",
      default: 0,
      min: 0,
      max: 100,
      step: 1,
      advanced: true
    },
    {
      name: "videoOverlayEnabled",
      label: "Sync video with ambient light",
      questionMark: {
        title: "Delays the video frames according to the ambient light frametimes.\nThis makes sure that that the ambient light is never out of sync with the video,\nbut it can introduce stuttering and/or dropped frames."
      },
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "videoOverlaySyncThreshold",
      label: "Sync video disable threshold",
      description: "Disable when dropping % of frames",
      type: "list",
      default: 5,
      min: 1,
      max: 100,
      step: 1,
      advanced: true
    },
    {
      name: "chromiumBugVideoJitterWorkaround",
      label: "Video jitter workaround",
      description: "Uses: CPU & GPU power",
      questionMark: {
        title: "Chromium has a bug that jitters the video playback when your display \nhas a higher framerate than 60Hz. This workaround prevents the jittering \nby forcing the browser to run at the framerate of your display instead. \nClick the questionmark for more information about this bug in Chromium browsers.",
        href: "https://github.com/WesselKroos/youtube-ambilight/issues/166"
      },
      type: "checkbox",
      default: false,
      // Should not be enabled by default because it also adds CPU & GPU overhead on 60Hz displays. (60Hz+ detection keeps toggling between off/on when VRR is enabled in the OS.)
      advanced: true
    },
    {
      name: "chromiumDirectVideoOverlayWorkaround",
      label: "Video artifacts workaround",
      description: "This workaround must be disabled for \nNVidia RTX Virtual Super Resolution (VSR)",
      questionMark: {
        title: `This workaround can fix several artifacts/bugs,
when videos are in hardware accelerated overlays (MPO).
Examples are: random black/white squares, flickering or a squeezed video.

Click on the questionmark for more and updated information about these artifacts/bugs.`,
        href: "https://github.com/WesselKroos/youtube-ambilight/blob/master/TROUBLESHOOT.md#3-nvidia-rtx-video-super-resolution-vsr--nvidia-rtx-video-hdr-does-not-work"
      },
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      type: "section",
      label: "Remove black & colored bars",
      name: "sectionHorizontalBarsCollapsed",
      default: true
    },
    {
      name: "detectHorizontalBarSizeEnabled",
      label: "Remove black bars",
      description: "Uses: CPU power",
      type: "checkbox",
      default: false,
      defaultKey: "B"
    },
    {
      name: "detectVerticalBarSizeEnabled",
      label: "Remove black sidebars",
      description: "Uses: CPU power",
      type: "checkbox",
      default: false,
      defaultKey: "V"
    },
    {
      name: "detectColoredHorizontalBarSizeEnabled",
      label: "Detection: Remove colored bars",
      type: "checkbox",
      default: false
    },
    {
      name: "detectHorizontalBarSizeOffsetPercentage",
      label: "Detection: Offset",
      type: "list",
      default: 0,
      min: -5,
      max: 5,
      step: 0.1,
      advanced: true
    },
    {
      name: "barSizeDetectionAverageHistorySize",
      label: "Detection: Frames average",
      questionMark: {
        title: "The amount of video frames to detect an average bar size from. \nA lower amount of frames results in a faster detection, \nbut does also increase the amount of inaccurate detections."
      },
      type: "list",
      default: 4,
      min: 1,
      max: 30,
      step: 1,
      advanced: true
    },
    {
      name: "barSizeDetectionAllowedElementsPercentage",
      label: "Detection: Certainty threshold",
      questionMark: {
        title: "At 10% only clear bars are removed.\nA higher percentage can also remove bars with some elements.\nAnd an even higher percentage can crop to a squared element in the center."
      },
      type: "list",
      default: 20,
      min: 10,
      max: 90,
      step: 10
      // advanced: true,
    },
    {
      name: "barSizeDetectionAllowedUnevenBarsPercentage",
      label: "Detection: Uneven threshold",
      questionMark: {
        title: "Higher percentages detect a more uneven bar.\nFor example: A bar is uneven when the top bar is smaller than the bottem bar.\nBut with a high percentage you also increase the risk that straight objects or lines are seen as bars."
      },
      type: "list",
      default: 10,
      min: 1,
      max: 50,
      step: 1,
      advanced: true,
      new: true
    },
    {
      name: "horizontalBarsClipPercentage",
      label: "Bar size",
      type: "list",
      default: 0,
      min: 0,
      max: 40,
      step: 0.1,
      snapPoints: [
        { value: 8.7, label: 8 },
        { value: 12.3, label: 12, flip: true },
        { value: 13.5, label: 13 }
      ],
      advanced: true
    },
    {
      name: "verticalBarsClipPercentage",
      label: "Sidebars size",
      type: "list",
      default: 0,
      min: 0,
      max: 40,
      step: 0.1,
      advanced: true
    },
    {
      name: "horizontalBarsClipPercentageReset",
      label: "Reset bars next video",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      name: "detectVideoFillScaleEnabled",
      label: "Fill video to removed bars",
      type: "checkbox",
      default: false,
      defaultKey: "H"
    },
    {
      type: "section",
      label: "Filters",
      name: "sectionImageAdjustmentCollapsed",
      default: true
    },
    {
      name: "brightness",
      label: "Brightness",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 1
    },
    {
      name: "contrast",
      label: "Contrast",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 1,
      advanced: true
    },
    {
      name: "vibrance",
      label: "Colors",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 0.1
    },
    {
      name: "saturation",
      label: "Saturation",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 1
    },
    {
      type: "section",
      label: "HDR Filters",
      name: "sectionHdrImageAdjustmentCollapsed",
      default: false,
      hdr: true
    },
    {
      name: "hdrBrightness",
      label: "Brightness",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 1,
      hdr: true
    },
    {
      name: "hdrContrast",
      label: "Contrast",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 1,
      hdr: true
    },
    {
      name: "hdrSaturation",
      label: "Saturation",
      type: "list",
      default: 100,
      min: 0,
      max: 200,
      step: 1,
      hdr: true
    },
    {
      type: "section",
      label: "Directions",
      name: "sectionDirectionsCollapsed",
      default: true,
      advanced: true
    },
    {
      name: "directionTopEnabled",
      label: "Top",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      name: "directionRightEnabled",
      label: "Right",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      name: "directionBottomEnabled",
      label: "Bottom",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      name: "directionLeftEnabled",
      label: "Left",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      type: "section",
      label: "Ambient light",
      name: "sectionAmbientlightCollapsed",
      default: false
    },
    {
      name: "blur2",
      label: "Blur",
      description: "Uses: GPU memory",
      type: "list",
      default: 30,
      min: 0,
      max: 100,
      step: 0.1
    },
    {
      name: "edge",
      label: "Edge size",
      description: "To better see what changes: Turn the blur to 0%",
      type: "list",
      default: 12,
      min: 2,
      max: 50,
      step: 0.1,
      advanced: true
    },
    {
      name: "spread",
      label: "Spread",
      description: "Uses: GPU power",
      type: "list",
      default: 17,
      min: 0,
      max: 400,
      step: 0.1
    },
    {
      name: "spreadFadeStart",
      label: "Spread fade start",
      type: "list",
      default: 15,
      min: -50,
      max: 100,
      step: 0.1,
      advanced: true
    },
    {
      name: "spreadFadeCurve",
      label: "Spread fade curve",
      description: "To better see what changes: Turn the blur to 0%",
      type: "list",
      default: 35,
      min: 1,
      max: 100,
      step: 1,
      advanced: true
    },
    {
      name: "debandingStrength",
      label: "Debanding (noise)",
      questionMark: {
        title: 'Click for more information about (noise /dithering).\nTip: Change the "Quality > Optimize debanding for" setting to "OLED" to retain pure blacks on OLED displays.',
        href: "https://www.lifewire.com/what-is-dithering-4686105"
      },
      type: "list",
      default: 0,
      min: 0,
      max: 100,
      step: 1,
      advanced: true
    },
    {
      name: "frameFading",
      label: "Fade in duration",
      description: "Uses: GPU memory",
      questionMark: {
        title: "Fading between changes in the ambient light"
      },
      type: "list",
      default: 0,
      min: 0,
      max: 21.2,
      // 15 seconds
      step: 0.02,
      manualinput: false
    },
    {
      name: "flickerReduction",
      label: "Flicker reduction",
      questionMark: {
        title: "Reduces flickering by limiting the speed at which brightness changes in the ambient light"
      },
      type: "list",
      default: 0,
      min: 0,
      max: 100,
      step: 1,
      manualinput: false,
      advanced: true
    },
    {
      name: "frameBlending",
      label: "Smooth motion (frame blending)",
      questionMark: {
        title: "Click for more information about Frame blending",
        href: "https://www.youtube.com/watch?v=m_wfO4fvH8M&t=81s"
      },
      description: 'Uses: GPU power. Also works with "Sync video"',
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "frameBlendingSmoothness",
      label: "Smooth motion strength",
      type: "list",
      default: 80,
      min: 0,
      max: 100,
      step: 1,
      advanced: true
    },
    {
      name: "fixedPosition",
      label: "Fixed position",
      description: "Ignores the scroll position of the page",
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      type: "section",
      label: "View modes",
      name: "sectionViewsCollapsed",
      default: false
    },
    {
      name: "enableInViews",
      label: "Enable in layouts",
      type: "list",
      manualinput: false,
      default: 0,
      min: 0,
      max: 5,
      step: 1,
      snapPoints: [
        { value: 0, label: "All" },
        { value: 1, label: "Small" },
        { value: 2, hiddenLabel: "Small & Theater" },
        { value: 3, label: "Theater" },
        { value: 4, hiddenLabel: "Theater & Fullscreen" },
        { value: 5, label: "Fullscreen" }
      ]
    },
    {
      name: "enableInPictureInPicture",
      label: "Picture in picture",
      type: "checkbox",
      default: false,
      advanced: true
    },
    {
      name: "enableInEmbed",
      label: "Embedded videos",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      name: "enableInVRVideos",
      label: "VR/360 videos",
      type: "checkbox",
      default: true,
      advanced: true
    },
    {
      type: "section",
      label: "General",
      name: "sectionGeneralCollapsed",
      default: false
    },
    {
      name: "theme",
      label: "Appearance (theme)",
      type: "list",
      manualinput: false,
      default: 1,
      min: -1,
      max: 1,
      step: 1,
      snapPoints: [
        { value: -1, label: "Light" },
        { value: 0, label: "Default" },
        { value: 1, label: "Dark" }
      ]
    },
    {
      name: "enabled",
      label: "Enabled",
      type: "checkbox",
      default: true,
      defaultKey: "G"
    }
  ];
  var settings_config_default = SettingsConfig;

  // src/ambilight.js
  /*! Ambient light renderer for nishal21's video page, built on youtube-ambilight's own code.
   * recreateProjectors(), resizeCanvasses(), the projector sizing and filter part of updateSizes(), the debanding
   * setup and the video frame callback scheduling are copied from youtube-ambilight src/scripts/libs/ambientlight.js
   * (commit 18d17188e5562e5ee913f005192d30c9a60be078) and trimmed to what this page needs: no YouTube page DOM,
   * no theater/fullscreen views, no HDR, VR, frame blending or video overlay, no stats UI.
   * MIT License, Copyright (c) 2017 Wessel Kroos. The full license is in ../LICENSE (vendor/ambilight/LICENSE). */
  setErrorHandler((ex) => console.warn("ambient light:", ex));
  var extensionDefaults = Object.fromEntries(
    settings_config_default.filter((s) => s.name && "default" in s && s.type !== "section").map((s) => [s.name, s.default])
  );
  var noop = () => {
  };
  var stats = { updateBarDetectionImage: noop, updateBarDetectionResult: noop, addBarDetectionDuration: noop, updateBarDetectionInfo: noop };
  var Ambilight = class {
    innerStrength = 2;
    videoScale = 100;
    barsClip = [0, 0];
    clippedVideoScale = [1, 1];
    atTop = true;
    isPageHidden = false;
    buffersCleared = true;
    sizesChanged = true;
    canvassesInvalidated = true;
    shouldStyleVideoParentElem = true;
    stats = stats;
    // container: the element the light lives in (positioned, behind the page); videoContainerElem: the player box
    constructor({ container, videoContainerElem, videoElem, settings, onWarning }) {
      this.container = container;
      this.videoContainerElem = videoContainerElem;
      this.videoElem = videoElem;
      const self = this;
      this.settings = {
        ...extensionDefaults,
        ...settings,
        setWarning: (text) => onWarning?.(text),
        set(name, value) {
          this[name] = value;
          if (name === "resolution") self.sizesChanged = true;
        }
      };
    }
    async init() {
      this.containerElem = document.createElement("div");
      this.containerElem.classList.add("ambientlight__container");
      this.filterElem = document.createElement("div");
      this.filterElem.classList.add("ambientlight__filter");
      this.clipElem = document.createElement("div");
      this.clipElem.classList.add("ambientlight__clip");
      this.projectorsElem = document.createElement("div");
      this.projectorsElem.classList.add("ambientlight__projectors");
      this.projectorListElem = document.createElement("div");
      this.projectorListElem.classList.add("ambientlight__projector-list");
      this.projectorsElem.append(this.projectorListElem);
      this.clipElem.append(this.projectorsElem);
      this.filterElem.append(this.clipElem);
      this.containerElem.append(this.filterElem);
      this.container.prepend(this.containerElem);
      this.barDetection = new BarDetection(this);
      const elem = new SafeOffscreenCanvas(1, 1, true);
      this.projectorBuffer = { elem, ctx: elem.getContext("2d", ctxOptions) };
      if (this.settings.webGL) {
        try {
          this.projector = await new ProjectorWebGL(this, this.projectorListElem, noop, this.settings);
        } catch (ex) {
          console.warn("ambient light: WebGL failed, using canvas 2D", ex);
          this.projector = void 0;
        }
      }
      if (!this.projector) {
        this.settings.webGL = false;
        this.projector = new Projector2d(this, this.projectorListElem, noop, this.settings);
      }
      this.updateStyles();
      return this;
    }
    // initProjector()'s canvas 2D branch, used when WebGL can't take the picture
    useProjector2d() {
      this.projectorListElem.replaceChildren();
      this.settings.webGL = false;
      this.projector = new Projector2d(this, this.projectorListElem, noop, this.settings);
      this.canvassesInvalidated = true;
      this.sizesChanged = true;
    }
    get type() {
      return this.projector?.type;
    }
    setSettings(values) {
      Object.assign(this.settings, values);
      this.canvassesInvalidated = true;
      this.sizesChanged = true;
      this.updateStyles();
    }
    // ambientlight.js recreateProjectors()
    recreateProjectors() {
      this.levels = Math.max(2, Math.round(this.settings.spread / this.settings.edge) + this.innerStrength + 1);
      if (this.projector.recreate) {
        this.projector.recreate(this.levels);
      }
    }
    // the part of ambientlight.js updateSizes() that places and sizes the projectors; the video rect is ours
    updateSizes(srcWidth, srcHeight) {
      const box = this.videoContainerElem, host = this.containerElem;
      if (!box.offsetWidth || !box.offsetHeight || !srcWidth || !srcHeight) return false;
      const unscaledWidth = box.offsetWidth, unscaledHeight = box.offsetHeight;
      const hostRect = host.getBoundingClientRect(), rect = box.getBoundingClientRect();
      this.videoOffset = { top: rect.top - hostRect.top, left: rect.left - hostRect.left, width: unscaledWidth, height: unscaledHeight };
      this.projectorsElem.style.left = `${this.videoOffset.left}px`;
      this.projectorsElem.style.top = `${this.videoOffset.top}px`;
      this.projectorsElem.style.width = `${unscaledWidth}px`;
      this.projectorsElem.style.height = `${unscaledHeight}px`;
      this.projectorsElem.style.transform = `scale(${this.clippedVideoScale[0]}, ${this.clippedVideoScale[1]})`;
      if (this.settings.webGL) this.projector.cropped = false;
      const blur = this.settings.blur2;
      const { contrast, brightness, saturation } = this.settings;
      this.filterElem.style.filter = `
      ${!this.settings.webGL && blur != 0 ? `blur(${Math.round(this.videoOffset.height * 25e-4 * this.settings.blur2)}px)` : ""}
      ${contrast != 100 ? `contrast(${contrast}%)` : ""}
      ${brightness != 100 ? `brightness(${brightness}%)` : ""}
      ${saturation != 100 ? `saturate(${saturation}%)` : ""}
    `.trim();
      this.srcVideoOffset = { top: this.videoOffset.top, width: srcWidth, height: srcHeight };
      let pScale;
      if (this.settings.webGL) {
        const relativeBlur = this.settings.resolution / 100 * this.settings.blur2;
        let pMinSize = this.settings.resolution / 100 * (this.settings.detectHorizontalBarSizeEnabled || this.settings.detectVerticalBarSizeEnabled ? 256 : relativeBlur >= 20 ? 128 : relativeBlur >= 10 ? 192 : 256);
        if (this.settings.spread > 200) pMinSize = pMinSize / 2;
        pScale = Math.min(
          0.5,
          Math.max(pMinSize / this.srcVideoOffset.width, pMinSize / this.srcVideoOffset.height),
          Math.min(1024 / this.srcVideoOffset.width, 1024 / this.srcVideoOffset.height)
        );
      } else {
        const pMinSize = Math.max(257, Math.min(512, this.srcVideoOffset.width, this.srcVideoOffset.height));
        pScale = Math.max(pMinSize / this.srcVideoOffset.width, pMinSize / this.srcVideoOffset.height);
      }
      this.p = { w: Math.ceil(this.srcVideoOffset.width * pScale), h: Math.ceil(this.srcVideoOffset.height * pScale) };
      if (this.canvassesInvalidated) {
        this.recreateProjectors();
        this.canvassesInvalidated = false;
      }
      this.projector.resize(this.p.w, this.p.h);
      if (this.projectorBuffer.elem.width !== this.p.w) this.projectorBuffer.elem.width = this.p.w;
      if (this.projectorBuffer.elem.height !== this.p.h) this.projectorBuffer.elem.height = this.p.h;
      this.resizeCanvasses();
      this.buffersCleared = true;
      this.sizesChanged = false;
      this.srcSize = [srcWidth, srcHeight];
      return true;
    }
    // ambientlight.js resizeCanvasses()
    resizeCanvasses() {
      if (this.canvassesInvalidated) {
        this.recreateProjectors();
        this.canvassesInvalidated = false;
      }
      const projectorSize = {
        w: Math.round(this.p.w * this.clippedVideoScale[0]),
        h: Math.round(this.p.h * this.clippedVideoScale[1])
      };
      const ratio = this.p.w > this.p.h ? { x: this.p.w / projectorSize.w, y: this.p.w / projectorSize.w * (projectorSize.w / projectorSize.h) } : { x: this.p.h / projectorSize.h * (projectorSize.h / projectorSize.w), y: this.p.h / projectorSize.h };
      const lastScale = { x: 1, y: 1 };
      const minScale = { x: 1 / projectorSize.w, y: 1 / projectorSize.h };
      const scaleStep = this.settings.edge / 100;
      const scales = [];
      for (let i = 0; i < this.levels; i++) {
        const pos = i - this.innerStrength;
        let scaleX = 1;
        let scaleY = 1;
        if (pos > 0) {
          scaleX = 1 + scaleStep * ratio.x * pos;
          scaleY = 1 + scaleStep * ratio.y * pos;
        }
        if (pos < 0) {
          scaleX = 1 - scaleStep * ratio.x * -pos;
          scaleY = 1 - scaleStep * ratio.y * -pos;
          if (scaleX < 0) scaleX = 0;
          if (scaleY < 0) scaleY = 0;
        }
        lastScale.x = scaleX;
        lastScale.y = scaleY;
        scales.push({ x: Math.max(minScale.x, scaleX), y: Math.max(minScale.y, scaleY) });
      }
      this.projector.rescale(scales, lastScale, projectorSize, this.barsClip, this.settings);
      this.scales = scales;
      this.lastScale = lastScale;
    }
    // debanding part of ambientlight.js updateStyles(), with the noise images vendored next to this file
    updateStyles() {
      const baseUrl = new URL("images/", this.settings.assetsUrl || location.href).href;
      const debandingStrength = parseFloat(this.settings.debandingStrength);
      const noiseImageIndex = debandingStrength > 75 ? 3 : debandingStrength > 50 ? 2 : 1;
      const noiseOpacity = debandingStrength / (debandingStrength > 75 ? 100 : debandingStrength > 50 ? 75 : 50);
      setStyleProperty(this.container, "--ytal-debanding-content", debandingStrength ? `''` : "");
      setStyleProperty(this.container, "--ytal-debanding-background", debandingStrength ? `url('${baseUrl}noise-${noiseImageIndex}.png')` : "");
      setStyleProperty(this.container, "--ytal-debanding-opacity", debandingStrength ? noiseOpacity : "");
    }
    // one frame: the extension draws the source into its projector buffer, then the projector draws the buffer.
    // src is the <video> or an image; sx..sh optionally pick a region (a storyboard tile)
    draw(src, sx, sy, sw, sh) {
      const w = sw ?? (src.videoWidth || src.naturalWidth || src.width);
      const h = sh ?? (src.videoHeight || src.naturalHeight || src.height);
      if (!w || !h) return false;
      if (this.sizesChanged || this.canvassesInvalidated || !this.p || this.srcSize?.[0] !== w || this.srcSize?.[1] !== h) {
        if (!this.updateSizes(w, h)) return false;
      }
      const buf = this.projectorBuffer;
      if (sw) buf.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, buf.elem.width, buf.elem.height);
      else buf.ctx.drawImage(src, 0, 0, buf.elem.width, buf.elem.height);
      try {
        this.projector.draw(buf.elem);
      } catch (ex) {
        if (this.settings.webGL && ex?.name === "SecurityError") {
          this.useProjector2d();
          return this.draw(src, sx, sy, sw, sh);
        }
        throw ex;
      }
      this.buffersCleared = false;
      this.frameCount = (this.frameCount || 0) + 1;
      if (this.settings.detectHorizontalBarSizeEnabled || this.settings.detectVerticalBarSizeEnabled) this.scheduleBarSizeDetection();
      return true;
    }
    // ambientlight.js scheduleBarSizeDetection() / scheduleBarSizeDetectionCallback(), at most twice a second
    scheduleBarSizeDetection() {
      const now = performance.now();
      if (this.barsReadable === false || now - (this.lastBarDetection || 0) < 500) return;
      this.lastBarDetection = now;
      try {
        this.projectorBuffer.ctx.getImageData(0, 0, 1, 1);
      } catch {
        this.barsReadable = false;
        return;
      }
      this.barDetection.detect(
        this.projectorBuffer.elem,
        this.settings.detectColoredHorizontalBarSizeEnabled,
        this.settings.detectHorizontalBarSizeOffsetPercentage,
        this.settings.detectHorizontalBarSizeEnabled,
        this.settings.horizontalBarsClipPercentage,
        this.settings.detectVerticalBarSizeEnabled,
        this.settings.verticalBarsClipPercentage,
        this.p ? this.p.h / this.p.w : 1,
        false,
        // the buffer is reused for the next frame, so it can't be transferred
        this.settings.barSizeDetectionAverageHistorySize || 1,
        this.settings.barSizeDetectionAllowedElementsPercentage || 20,
        this.settings.barSizeDetectionAllowedUnevenBarsPercentage || 20,
        (horizontal, vertical) => {
          let changed = false;
          if (this.settings.detectHorizontalBarSizeEnabled && horizontal !== void 0 && this.settings.horizontalBarsClipPercentage !== horizontal) {
            this.settings.horizontalBarsClipPercentage = horizontal;
            changed = true;
          }
          if (this.settings.detectVerticalBarSizeEnabled && vertical !== void 0 && this.settings.verticalBarsClipPercentage !== vertical) {
            this.settings.verticalBarsClipPercentage = vertical;
            changed = true;
          }
          if (changed) this.updateBarsClip();
        }
      ).catch(() => {
        this.barsReadable = false;
      });
    }
    // from ambientlight.js updateSizes(): the bars are cut off the projected picture
    updateBarsClip() {
      const h = this.settings.detectHorizontalBarSizeEnabled ? (this.settings.horizontalBarsClipPercentage || 0) / 100 : 0;
      const v = this.settings.detectVerticalBarSizeEnabled ? (this.settings.verticalBarsClipPercentage || 0) / 100 : 0;
      this.barsClip = [v, h];
      this.clippedVideoScale = this.barsClip.map((p) => 1 - p * 2);
      this.sizesChanged = true;
    }
    resetBars() {
      this.barDetection?.reset();
      this.settings.horizontalBarsClipPercentage = 0;
      this.settings.verticalBarsClipPercentage = 0;
      this.barsReadable = void 0;
      this.updateBarsClip();
    }
    clear() {
      this.barDetection?.clear();
      this.projector?.clearRect?.();
      this.buffersCleared = true;
    }
    // isPageHidden / atTop hooks the projector reads
    optionalFrame = async () => {
    };
    setDrawWarning = noop;
  };
  function followVideoFrames(videoElem, onFrame) {
    let id = 0, stopped = false;
    if (!videoElem.requestVideoFrameCallback) return null;
    const step = (now, info) => {
      if (stopped) return;
      videoElem.requestVideoFrameCallback(function prescheduledVFC() {
      });
      id = videoElem.requestVideoFrameCallback(step);
      onFrame(now, info);
    };
    id = videoElem.requestVideoFrameCallback(step);
    return () => {
      stopped = true;
      videoElem.cancelVideoFrameCallback?.(id);
    };
  }
  return __toCommonJS(ambilight_exports);
})();
