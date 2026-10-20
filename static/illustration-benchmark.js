// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/array.mjs
function addUniqueItem(arr, item) {
  if (arr.indexOf(item) === -1)
    arr.push(item);
}
function removeItem(arr, item) {
  const index = arr.indexOf(item);
  if (index > -1)
    arr.splice(index, 1);
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/clamp.mjs
var clamp = (min, max, v) => {
  if (v > max)
    return max;
  if (v < min)
    return min;
  return v;
};

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/format-error-message.mjs
function formatErrorMessage(message, errorCode) {
  return errorCode ? `${message}. For more information and steps for solving, visit https://motion.dev/troubleshooting/${errorCode}` : message;
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/errors.mjs
var warning = () => {
};
var invariant = () => {
};
if (typeof process !== "undefined" && true) {
  warning = (check, message, errorCode) => {
    if (!check && typeof console !== "undefined") {
      console.warn(formatErrorMessage(message, errorCode));
    }
  };
  invariant = (check, message, errorCode) => {
    if (!check) {
      throw new Error(formatErrorMessage(message, errorCode));
    }
  };
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/global-config.mjs
var MotionGlobalConfig = {};

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/is-numerical-string.mjs
var isNumericalString = (v) => /^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(v);

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/is-object.mjs
var isObject = (value) => typeof value === "object" && value !== null;

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/is-zero-value-string.mjs
var isZeroValueString = (v) => /^0[^.\s]+$/u.test(v);

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/memo.mjs
// @__NO_SIDE_EFFECTS__
function memo(callback) {
  let result;
  return () => {
    if (result === void 0)
      result = callback();
    return result;
  };
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/noop.mjs
var noop = /* @__NO_SIDE_EFFECTS__ */ (any) => any;

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/pipe.mjs
var pipe = (...transformers) => transformers.reduce((a, b) => (v) => b(a(v)));

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/progress.mjs
var progress = /* @__NO_SIDE_EFFECTS__ */ (from, to, value) => {
  const range = to - from;
  return range ? (value - from) / range : 1;
};

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/subscription-manager.mjs
var SubscriptionManager = class {
  constructor() {
    this.subscriptions = [];
  }
  add(handler) {
    addUniqueItem(this.subscriptions, handler);
    return () => this.remove(handler);
  }
  remove(handler) {
    removeItem(this.subscriptions, handler);
  }
  notify(a, b, c) {
    const numSubscriptions = this.subscriptions.length;
    if (!numSubscriptions)
      return;
    if (numSubscriptions === 1) {
      this.subscriptions[0](a, b, c);
    } else {
      for (let i = 0; i < numSubscriptions; i++) {
        const handler = this.subscriptions[i];
        handler && handler(a, b, c);
      }
    }
  }
  getSize() {
    return this.subscriptions.length;
  }
  clear() {
    this.subscriptions.length = 0;
  }
};

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/time-conversion.mjs
var secondsToMilliseconds = /* @__NO_SIDE_EFFECTS__ */ (seconds) => seconds * 1e3;
var millisecondsToSeconds = /* @__NO_SIDE_EFFECTS__ */ (milliseconds) => milliseconds / 1e3;

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/velocity-per-second.mjs
var velocityPerSecond = /* @__NO_SIDE_EFFECTS__ */ (velocity, frameDuration) => frameDuration ? velocity * (1e3 / frameDuration) : 0;

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/warn-once.mjs
var warned = /* @__PURE__ */ new Set();
function warnOnce(condition, message, errorCode) {
  if (condition || warned.has(message))
    return;
  console.warn(formatErrorMessage(message, errorCode));
  warned.add(message);
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/wrap.mjs
var wrap = (min, max, v) => {
  const rangeSize = max - min;
  return ((v - min) % rangeSize + rangeSize) % rangeSize + min;
};

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/cubic-bezier.mjs
var calcBezier = (t, a1, a2) => t * (3 * (1 - t) * ((1 - t) * a1 + t * a2) + t * t);
// @__NO_SIDE_EFFECTS__
function cubicBezier(mX1, mY1, mX2, mY2) {
  if (mX1 === mY1 && mX2 === mY2)
    return noop;
  return (x) => {
    let lowerBound = 0;
    let upperBound = 1;
    let t = x;
    for (let i = 0; ; i++) {
      if (!(t >= lowerBound && t <= upperBound)) {
        t = (lowerBound + upperBound) / 2;
      }
      const currentX = calcBezier(t, mX1, mX2) - x;
      if (currentX * currentX < 1e-28 || i === 40)
        break;
      currentX > 0 ? upperBound = t : lowerBound = t;
      t -= currentX * 1e-7 / (calcBezier(t + 1e-7, mX1, mX2) - x - currentX);
    }
    return calcBezier(t, mY1, mY2);
  };
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/modifiers/mirror.mjs
var mirrorEasing = /* @__NO_SIDE_EFFECTS__ */ (easing) => (p) => p <= 0.5 ? easing(2 * p) / 2 : (2 - easing(2 * (1 - p))) / 2;

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/modifiers/reverse.mjs
var reverseEasing = /* @__NO_SIDE_EFFECTS__ */ (easing) => (p) => 1 - easing(1 - p);

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/back.mjs
var backOut = /* @__PURE__ */ cubicBezier(0.33, 1.53, 0.69, 0.99);
var backIn = /* @__PURE__ */ reverseEasing(backOut);
var backInOut = /* @__PURE__ */ mirrorEasing(backIn);

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/anticipate.mjs
var anticipate = (p) => p >= 1 ? 1 : (p *= 2) < 1 ? 0.5 * backIn(p) : 0.5 * (2 - Math.pow(2, -10 * (p - 1)));

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/circ.mjs
var circIn = (p) => 1 - Math.sin(Math.acos(p));
var circOut = reverseEasing(circIn);
var circInOut = mirrorEasing(circIn);

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/ease.mjs
var easeIn = /* @__PURE__ */ cubicBezier(0.42, 0, 1, 1);
var easeOut = /* @__PURE__ */ cubicBezier(0, 0, 0.58, 1);
var easeInOut = /* @__PURE__ */ cubicBezier(0.42, 0, 0.58, 1);

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/utils/is-easing-array.mjs
var isEasingArray = /* @__NO_SIDE_EFFECTS__ */ (ease2) => {
  return Array.isArray(ease2) && typeof ease2[0] !== "number";
};

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/utils/get-easing-for-segment.mjs
// @__NO_SIDE_EFFECTS__
function getEasingForSegment(easing, i) {
  return isEasingArray(easing) ? easing[wrap(0, easing.length, i)] : easing;
}

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/utils/is-bezier-definition.mjs
var isBezierDefinition = /* @__NO_SIDE_EFFECTS__ */ (easing) => Array.isArray(easing) && typeof easing[0] === "number";

// node_modules/.pnpm/motion-utils@14.1.1/node_modules/motion-utils/dist/es/easing/utils/map.mjs
var easingLookup = {
  linear: noop,
  easeIn,
  easeInOut,
  easeOut,
  circIn,
  circInOut,
  circOut,
  backIn,
  backInOut,
  backOut,
  anticipate
};
var isValidEasing = (easing) => {
  return typeof easing === "string";
};
var easingDefinitionToFunction = (definition) => {
  if (isBezierDefinition(definition)) {
    invariant(definition.length === 4, `Cubic bezier arrays must contain four numerical values.`, "cubic-bezier-length");
    const [x1, y1, x2, y2] = definition;
    return cubicBezier(x1, y1, x2, y2);
  } else if (isValidEasing(definition)) {
    invariant(easingLookup[definition] !== void 0, `Invalid easing type '${definition}'`, "invalid-easing-type");
    return easingLookup[definition];
  }
  return definition;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/frameloop/frame-data.mjs
var frameData = {
  delta: 0,
  timestamp: 0,
  isProcessing: false
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/frameloop/sync-time.mjs
var now;
function clearTime() {
  now = void 0;
}
var time = {
  now: () => {
    if (now === void 0) {
      time.set(frameData.isProcessing || MotionGlobalConfig.useManualTiming ? frameData.timestamp : performance.now());
    }
    return now;
  },
  set: (newTime) => {
    now = newTime;
    queueMicrotask(clearTime);
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/sanitize.mjs
var sanitize = (v) => Math.round(v * 1e5) / 1e5;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/is-css-variable.mjs
var checkStringStartsWith = (token) => (key) => typeof key === "string" && key.startsWith(token);
var startsAsVariableToken = /* @__PURE__ */ checkStringStartsWith("var(--");
var isCSSVariableToken = (value) => {
  const startsWithToken = startsAsVariableToken(value);
  if (!startsWithToken)
    return false;
  return singleCssVariableRegex.test(value.split("/*")[0].trim());
};
var singleCssVariableRegex = /var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu;
function containsCSSVariable(value) {
  if (typeof value !== "string")
    return false;
  return value.split("/*")[0].includes("var(--");
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/numbers/index.mjs
var number = {
  test: (v) => typeof v === "number",
  parse: parseFloat,
  transform: (v) => v
};
var alpha = {
  ...number,
  transform: (v) => clamp(0, 1, v)
};
var scale = {
  ...number,
  default: 1
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/float-regex.mjs
var floatRegex = /-?(?:\d+(?:\.\d+)?|\.\d+)/gu;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/is-nullish.mjs
function isNullish(v) {
  return v == null;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/single-color-regex.mjs
var singleColorRegex = /^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/color/utils.mjs
var isColorString = (type, testProp) => (v) => {
  return Boolean(typeof v === "string" && singleColorRegex.test(v) && v.startsWith(type) || testProp && !isNullish(v) && Object.prototype.hasOwnProperty.call(v, testProp));
};
var splitColor = (aName, bName, cName) => (v) => {
  if (typeof v !== "string")
    return v;
  const [a, b, c, alpha2] = v.match(floatRegex);
  return {
    [aName]: parseFloat(a),
    [bName]: parseFloat(b),
    [cName]: parseFloat(c),
    alpha: alpha2 !== void 0 ? parseFloat(alpha2) : 1
  };
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/color/rgba.mjs
var clampRgbUnit = (v) => clamp(0, 255, v);
var rgbUnit = {
  ...number,
  transform: (v) => Math.round(clampRgbUnit(v))
};
var rgba = {
  test: /* @__PURE__ */ isColorString("rgb", "red"),
  parse: /* @__PURE__ */ splitColor("red", "green", "blue"),
  transform: ({ red, green, blue, alpha: alpha$1 = 1 }) => "rgba(" + rgbUnit.transform(red) + ", " + rgbUnit.transform(green) + ", " + rgbUnit.transform(blue) + ", " + sanitize(alpha.transform(alpha$1)) + ")"
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/color/hex.mjs
function parseHex(v) {
  let r = "";
  let g = "";
  let b = "";
  let a = "";
  if (v.length > 5) {
    r = v.substring(1, 3);
    g = v.substring(3, 5);
    b = v.substring(5, 7);
    a = v.substring(7, 9);
  } else {
    r = v.substring(1, 2);
    g = v.substring(2, 3);
    b = v.substring(3, 4);
    a = v.substring(4, 5);
    r += r;
    g += g;
    b += b;
    a += a;
  }
  return {
    red: parseInt(r, 16),
    green: parseInt(g, 16),
    blue: parseInt(b, 16),
    alpha: a ? parseInt(a, 16) / 255 : 1
  };
}
var hex = {
  test: /* @__PURE__ */ isColorString("#"),
  parse: parseHex,
  transform: rgba.transform
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/numbers/units.mjs
var createUnitType = /* @__NO_SIDE_EFFECTS__ */ (unit) => ({
  test: (v) => typeof v === "string" && v.endsWith(unit) && v.split(" ").length === 1,
  parse: parseFloat,
  transform: (v) => `${v}${unit}`
});
var degrees = /* @__PURE__ */ createUnitType("deg");
var percent = /* @__PURE__ */ createUnitType("%");
var px = /* @__PURE__ */ createUnitType("px");
var vh = /* @__PURE__ */ createUnitType("vh");
var vw = /* @__PURE__ */ createUnitType("vw");
var progressPercentage = /* @__PURE__ */ (() => ({
  ...percent,
  parse: (v) => percent.parse(v) / 100,
  transform: (v) => percent.transform(v * 100)
}))();

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/color/hsla.mjs
var hsla = {
  test: /* @__PURE__ */ isColorString("hsl", "hue"),
  parse: /* @__PURE__ */ splitColor("hue", "saturation", "lightness"),
  transform: ({ hue, saturation, lightness, alpha: alpha$1 = 1 }) => {
    return "hsla(" + Math.round(hue) + ", " + percent.transform(sanitize(saturation)) + ", " + percent.transform(sanitize(lightness)) + ", " + sanitize(alpha.transform(alpha$1)) + ")";
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/color/index.mjs
var color = {
  test: (v) => rgba.test(v) || hex.test(v) || hsla.test(v),
  parse: (v) => {
    if (rgba.test(v)) {
      return rgba.parse(v);
    } else if (hsla.test(v)) {
      return hsla.parse(v);
    } else {
      return hex.parse(v);
    }
  },
  transform: (v) => {
    return typeof v === "string" ? v : v.hasOwnProperty("red") ? rgba.transform(v) : hsla.transform(v);
  },
  getAnimatableNone: (v) => {
    const parsed = color.parse(v);
    parsed.alpha = 0;
    return color.transform(parsed);
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/color-regex.mjs
var colorRegex = /(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/complex/index.mjs
var hasFloat = /* @__PURE__ */ new RegExp(floatRegex.source);
var hasColor = /* @__PURE__ */ new RegExp(colorRegex.source, "i");
function test(v) {
  return isNaN(v) && typeof v === "string" && (hasFloat.test(v) || hasColor.test(v));
}
var NUMBER_TOKEN = "number";
var COLOR_TOKEN = "color";
var VAR_TOKEN = "var";
var VAR_FUNCTION_TOKEN = "var(";
var SPLIT_TOKEN = "${}";
var complexRegex = /var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)(?![a-z]*\()/giu;
function hasComplexValues(value) {
  const asString = value.toString();
  return hasFloat.test(asString) || hasColor.test(asString);
}
function analyseComplexValue(value) {
  const originalValue = value.toString();
  const values = [];
  const indexes = {
    color: [],
    number: [],
    var: []
  };
  const types = [];
  let i = 0;
  const tokenised = originalValue.replace(complexRegex, (parsedValue) => {
    if (color.test(parsedValue)) {
      indexes.color.push(i);
      types.push(COLOR_TOKEN);
      values.push(color.parse(parsedValue));
    } else if (parsedValue.startsWith(VAR_FUNCTION_TOKEN)) {
      indexes.var.push(i);
      types.push(VAR_TOKEN);
      values.push(parsedValue);
    } else {
      indexes.number.push(i);
      types.push(NUMBER_TOKEN);
      values.push(parseFloat(parsedValue));
    }
    ++i;
    return SPLIT_TOKEN;
  });
  const split = tokenised.split(SPLIT_TOKEN);
  return { values, split, indexes, types };
}
function parseComplexValue(v) {
  return analyseComplexValue(v).values;
}
function buildTransformer({ split, types }) {
  const numSections = split.length;
  return (v) => {
    let output = "";
    for (let i = 0; i < numSections; i++) {
      output += split[i];
      if (v[i] !== void 0) {
        const type = types[i];
        if (type === NUMBER_TOKEN) {
          output += sanitize(v[i]);
        } else if (type === COLOR_TOKEN) {
          output += color.transform(v[i]);
        } else {
          output += v[i];
        }
      }
    }
    return output;
  };
}
function createTransformer(source) {
  return buildTransformer(analyseComplexValue(source));
}
var convertNumbersToZero = (v) => typeof v === "number" ? 0 : color.test(v) ? color.getAnimatableNone(v) : v;
var convertToZero = (value, splitBefore) => {
  if (typeof value === "number") {
    return splitBefore?.trim().endsWith("/") ? value : 0;
  }
  return convertNumbersToZero(value);
};
function getAnimatableNone(v) {
  const info = analyseComplexValue(v);
  const transformer = buildTransformer(info);
  return transformer(info.values.map((value, i) => convertToZero(value, info.split[i])));
}
var complex = {
  test,
  parse: parseComplexValue,
  createTransformer,
  getAnimatableNone
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/color/hsla-to-rgba.mjs
function hueToRgb(p, q, t) {
  if (t < 0)
    t += 1;
  if (t > 1)
    t -= 1;
  if (t < 1 / 6)
    return p + (q - p) * 6 * t;
  if (t < 1 / 2)
    return q;
  if (t < 2 / 3)
    return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslaToRgba({ hue, saturation, lightness, alpha: alpha2 }) {
  hue /= 360;
  saturation /= 100;
  lightness /= 100;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (!saturation) {
    red = green = blue = lightness;
  } else {
    const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation;
    const p = 2 * lightness - q;
    red = hueToRgb(p, q, hue + 1 / 3);
    green = hueToRgb(p, q, hue);
    blue = hueToRgb(p, q, hue - 1 / 3);
  }
  return {
    red: Math.round(red * 255),
    green: Math.round(green * 255),
    blue: Math.round(blue * 255),
    alpha: alpha2
  };
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/mix/immediate.mjs
function mixImmediate(a, b) {
  return (p) => p > 0 ? b : a;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/mix/number.mjs
var mixNumber = (from, to, progress2) => {
  return from + (to - from) * progress2;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/mix/color.mjs
var mixLinearColor = (from, to, v) => {
  const fromExpo = from * from;
  const expo = v * (to * to - fromExpo) + fromExpo;
  return expo < 0 ? 0 : Math.sqrt(expo);
};
var colorTypes = [hex, rgba, hsla];
var getColorType = (v) => colorTypes.find((type) => type.test(v));
function asRGBA(color2) {
  const type = getColorType(color2);
  if (!type) {
    warning(false, `'${color2}' is not an animatable color. Use the equivalent color code instead.`, "color-not-animatable");
    return false;
  }
  let model = type.parse(color2);
  if (type === hsla) {
    model = hslaToRgba(model);
  }
  return model;
}
var mixColor = (from, to) => {
  const fromRGBA = asRGBA(from);
  const toRGBA = asRGBA(to);
  if (!fromRGBA || !toRGBA) {
    return mixImmediate(from, to);
  }
  const blended = { ...fromRGBA };
  return (v) => {
    blended.red = mixLinearColor(fromRGBA.red, toRGBA.red, v);
    blended.green = mixLinearColor(fromRGBA.green, toRGBA.green, v);
    blended.blue = mixLinearColor(fromRGBA.blue, toRGBA.blue, v);
    blended.alpha = mixNumber(fromRGBA.alpha, toRGBA.alpha, v);
    return rgba.transform(blended);
  };
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/mix/visibility.mjs
var invisibleValues = /* @__PURE__ */ new Set(["none", "hidden"]);
function mixVisibility(origin, target) {
  if (invisibleValues.has(origin)) {
    return (p) => p <= 0 ? origin : target;
  } else {
    return (p) => p >= 1 ? target : origin;
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/mix/complex.mjs
function mixNumber2(a, b) {
  return (p) => mixNumber(a, b, p);
}
function getMixer(a) {
  if (typeof a === "number") {
    return mixNumber2;
  } else if (typeof a === "string") {
    return isCSSVariableToken(a) ? mixImmediate : color.test(a) ? mixColor : mixComplex;
  } else if (Array.isArray(a)) {
    return mixArray;
  } else if (typeof a === "object") {
    return color.test(a) ? mixColor : mixObject;
  }
  return mixImmediate;
}
function mixArray(a, b) {
  const output = [...a];
  const numValues = output.length;
  const blendValue = a.map((v, i) => getMixer(v)(v, b[i]));
  return (p) => {
    for (let i = 0; i < numValues; i++) {
      output[i] = blendValue[i](p);
    }
    return output;
  };
}
function mixObject(a, b) {
  const output = { ...a, ...b };
  const blendValue = {};
  for (const key in output) {
    if (a[key] !== void 0 && b[key] !== void 0) {
      blendValue[key] = getMixer(a[key])(a[key], b[key]);
    }
  }
  return (v) => {
    for (const key in blendValue) {
      output[key] = blendValue[key](v);
    }
    return output;
  };
}
function matchOrder(origin, target) {
  const orderedOrigin = [];
  const pointers = { color: 0, var: 0, number: 0 };
  for (let i = 0; i < target.values.length; i++) {
    const type = target.types[i];
    const originIndex = origin.indexes[type][pointers[type]];
    const originValue = origin.values[originIndex] ?? 0;
    orderedOrigin[i] = originValue;
    pointers[type]++;
  }
  return orderedOrigin;
}
var mixComplex = (origin, target) => {
  const template = complex.createTransformer(target);
  const originStats = analyseComplexValue(origin);
  const targetStats = analyseComplexValue(target);
  const canInterpolate = originStats.indexes.var.length === targetStats.indexes.var.length && originStats.indexes.color.length === targetStats.indexes.color.length && originStats.indexes.number.length >= targetStats.indexes.number.length;
  if (canInterpolate) {
    if (invisibleValues.has(origin) && !targetStats.values.length || invisibleValues.has(target) && !originStats.values.length) {
      return mixVisibility(origin, target);
    }
    return pipe(mixArray(matchOrder(originStats, targetStats), targetStats.values), template);
  } else {
    warning(true, `Complex values '${origin}' and '${target}' too different to mix. Ensure all colors are of the same type, and that each contains the same quantity of number and color values. Falling back to instant transition.`, "complex-values-different");
    return mixImmediate(origin, target);
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/mix/index.mjs
var unitValue = /^(-?(?:\d+(?:\.\d*)?|\.\d+))([a-z%]*)$/iu;
function mixUnit(from, to) {
  const a = unitValue.exec(from);
  if (!a)
    return;
  const b = unitValue.exec(to);
  if (!b || a[2] !== b[2])
    return;
  const unit = a[2];
  const origin = parseFloat(a[1]);
  const target = parseFloat(b[1]);
  return (p) => sanitize(mixNumber(origin, target, p)) + unit;
}
function mix(from, to, p) {
  if (typeof from === "number" && typeof to === "number" && typeof p === "number") {
    return mixNumber(from, to, p);
  }
  if (typeof from === "string" && typeof to === "string") {
    const mixer2 = mixUnit(from, to);
    if (mixer2)
      return mixer2;
  }
  const mixer = getMixer(from);
  return mixer(from, to);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/frameloop/order.mjs
var stepsOrder = [
  "setup",
  // Compute
  "read",
  // Read
  "resolveKeyframes",
  // Write/Read/Write/Read
  "preUpdate",
  // Compute
  "update",
  // Compute
  "preRender",
  // Compute
  "render",
  // Write
  "postRender"
  // Compute
];

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/frameloop/render-step.mjs
function createRenderStep(runNextFrame) {
  let thisFrame = /* @__PURE__ */ new Set();
  let nextFrame = /* @__PURE__ */ new Set();
  let isProcessing = false;
  let flushNextFrame = false;
  const toKeepAlive = /* @__PURE__ */ new Set();
  let latestFrameData = {
    delta: 0,
    timestamp: 0,
    isProcessing: false
  };
  function triggerCallback(callback) {
    if (toKeepAlive.has(callback)) {
      nextFrame.add(callback);
      runNextFrame();
    }
    callback(latestFrameData);
  }
  const step = {
    /**
     * Schedule a process to run on the next frame.
     */
    schedule: (callback, keepAlive = false, immediate = false) => {
      const addToCurrentFrame = immediate && isProcessing;
      const queue = addToCurrentFrame ? thisFrame : nextFrame;
      if (keepAlive)
        toKeepAlive.add(callback);
      queue.add(callback);
      return callback;
    },
    /**
     * Cancel the provided callback from running on the next frame.
     */
    cancel: (callback) => {
      nextFrame.delete(callback);
      toKeepAlive.delete(callback);
    },
    /**
     * Execute all schedule callbacks.
     */
    process: (frameData2) => {
      latestFrameData = frameData2;
      if (isProcessing) {
        flushNextFrame = true;
        return;
      }
      isProcessing = true;
      const prevFrame = thisFrame;
      thisFrame = nextFrame;
      nextFrame = prevFrame;
      thisFrame.forEach(triggerCallback);
      thisFrame.clear();
      isProcessing = false;
      if (flushNextFrame) {
        flushNextFrame = false;
        step.process(frameData2);
      }
    }
  };
  return step;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/frameloop/batcher.mjs
var maxElapsed = 40;
function createRenderBatcher(scheduleNextBatch, allowKeepAlive, state = {
  delta: 0,
  timestamp: 0,
  isProcessing: false
}) {
  let runNextFrame = false;
  let useDefaultElapsed = true;
  const flagRunNextFrame = () => runNextFrame = true;
  const steps = stepsOrder.reduce((acc, key) => {
    acc[key] = createRenderStep(flagRunNextFrame);
    return acc;
  }, {});
  const { setup, read: read2, resolveKeyframes, preUpdate, update, preRender, render, postRender } = steps;
  const processBatch = () => {
    const useManualTiming = MotionGlobalConfig.useManualTiming;
    const timestamp = useManualTiming ? state.timestamp : performance.now();
    runNextFrame = false;
    if (!useManualTiming) {
      state.delta = useDefaultElapsed ? 1e3 / 60 : Math.max(Math.min(timestamp - state.timestamp, maxElapsed), 1);
    }
    state.timestamp = timestamp;
    state.isProcessing = true;
    setup.process(state);
    read2.process(state);
    resolveKeyframes.process(state);
    preUpdate.process(state);
    update.process(state);
    preRender.process(state);
    render.process(state);
    postRender.process(state);
    state.isProcessing = false;
    if (runNextFrame && allowKeepAlive) {
      useDefaultElapsed = false;
      scheduleNextBatch(processBatch);
    }
  };
  const wake = () => {
    runNextFrame = true;
    useDefaultElapsed = true;
    if (!state.isProcessing) {
      scheduleNextBatch(processBatch);
    }
  };
  const schedule = stepsOrder.reduce((acc, key) => {
    const step = steps[key];
    acc[key] = (process2, keepAlive = false, immediate = false) => {
      if (!runNextFrame)
        wake();
      return step.schedule(process2, keepAlive, immediate);
    };
    return acc;
  }, {});
  const cancel = (process2) => {
    for (let i = 0; i < stepsOrder.length; i++) {
      steps[stepsOrder[i]].cancel(process2);
    }
  };
  return { schedule, cancel, state, steps };
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/frameloop/frame.mjs
var { schedule: frame, cancel: cancelFrame, steps: frameSteps } = /* @__PURE__ */ createRenderBatcher(typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : noop, true, frameData);

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/drivers/frame.mjs
var frameloopDriver = (update) => {
  const passTimestamp = ({ timestamp }) => update(timestamp);
  return {
    start: (keepAlive = true) => frame.update(passTimestamp, keepAlive),
    stop: () => cancelFrame(passTimestamp),
    /**
     * If we're processing this frame we can use the
     * framelocked timestamp to keep things in sync.
     */
    now: () => frameData.isProcessing ? frameData.timestamp : time.now()
  };
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/utils/linear.mjs
var generateLinearEasing = (easing, duration, resolution = 10) => {
  let points = "";
  const numPoints = Math.max(Math.round(duration / resolution), 2);
  for (let i = 0; i < numPoints; i++) {
    points += Math.round(easing(i / (numPoints - 1)) * 1e4) / 1e4 + ", ";
  }
  return `linear(${points.substring(0, points.length - 2)})`;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/utils/calc-duration.mjs
var maxGeneratorDuration = 2e4;
function calcGeneratorDuration(generator, timeStep = 50, maxDuration = maxGeneratorDuration, keyframes2) {
  let duration = 0;
  let state = generator.next(duration);
  keyframes2?.push(state.value);
  while (!state.done && duration < maxDuration) {
    duration += timeStep;
    state = generator.next(duration);
    keyframes2?.push(state.value);
  }
  return duration >= maxDuration ? Infinity : duration;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/utils/create-generator-easing.mjs
function createGeneratorEasing(options, scale2 = 100, createGenerator) {
  const { keyframes: k, velocity: v } = options;
  const delta = k && k[k.length - 1] - k[0];
  const generator = createGenerator({
    ...options,
    velocity: v && delta ? v * scale2 / delta : v,
    keyframes: [0, scale2]
  });
  const duration = Math.min(calcGeneratorDuration(generator), maxGeneratorDuration);
  return {
    type: "keyframes",
    ease: (progress2) => {
      return generator.next(duration * progress2).value / scale2;
    },
    duration: millisecondsToSeconds(duration)
  };
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/spring.mjs
var springDefaults = {
  // Default spring physics
  stiffness: 100,
  damping: 10,
  mass: 1,
  // Default duration/bounce-based options
  duration: 800,
  // in ms
  bounce: 0.3,
  visualDuration: 0.3,
  // in seconds
  // Rest thresholds
  restSpeed: {
    granular: 0.01,
    default: 2
  },
  restDelta: {
    granular: 5e-3,
    default: 0.5
  },
  // Limits
  minDuration: 0.01,
  // in seconds
  maxDuration: 10,
  // in seconds
  minDamping: 0.05
};
var bounceToDampingRatio = (bounce) => bounce < 0 ? 1 / Math.max(1 + bounce, springDefaults.minDamping) : Math.max(1 - bounce, springDefaults.minDamping);
function overdampedFreqScale(dampingRatio, criticalFreqTime) {
  if (!(dampingRatio > 1))
    return 1;
  const root2 = Math.sqrt(dampingRatio * dampingRatio - 1);
  const slow = dampingRatio - root2;
  const fast = dampingRatio + root2;
  const target = 2 * root2 * Math.exp(-criticalFreqTime) * (1 + criticalFreqTime);
  return approximateRoot((freqTime) => fast * Math.exp(-slow * freqTime) - slow * Math.exp(-fast * freqTime) - target, (freqTime) => Math.exp(-fast * freqTime) - Math.exp(-slow * freqTime), criticalFreqTime) / criticalFreqTime;
}
function calcAngularFreq(undampedFreq, dampingRatio) {
  return undampedFreq * Math.sqrt(1 - dampingRatio * dampingRatio);
}
var rootIterations = 12;
function approximateRoot(envelope, derivative, initialGuess) {
  let result = initialGuess;
  for (let i = 1; i < rootIterations; i++) {
    result = result - envelope(result) / derivative(result);
  }
  return result;
}
var safeMin = 1e-3;
function findSpring({ duration = springDefaults.duration, bounce = springDefaults.bounce }) {
  let envelope;
  let derivative;
  warning(duration <= secondsToMilliseconds(springDefaults.maxDuration), "Spring duration must be 10 seconds or less", "spring-duration-limit");
  const dampingRatio = bounceToDampingRatio(bounce);
  duration = clamp(springDefaults.minDuration, springDefaults.maxDuration, millisecondsToSeconds(duration));
  if (dampingRatio < 1) {
    envelope = (undampedFreq2) => {
      const exponentialDecay = undampedFreq2 * dampingRatio;
      const delta = exponentialDecay * duration;
      const b = calcAngularFreq(undampedFreq2, dampingRatio);
      const c = Math.exp(-delta);
      return safeMin - exponentialDecay / b * c;
    };
    derivative = (undampedFreq2) => {
      const exponentialDecay = undampedFreq2 * dampingRatio;
      const delta = exponentialDecay * duration;
      const e = dampingRatio * dampingRatio * undampedFreq2 * undampedFreq2 * duration;
      const f = Math.exp(-delta);
      const g = calcAngularFreq(undampedFreq2 * undampedFreq2, dampingRatio);
      const factor = -envelope(undampedFreq2) + safeMin > 0 ? -1 : 1;
      return factor * -e * f / g;
    };
  } else {
    envelope = (undampedFreq2) => {
      const a = Math.exp(-undampedFreq2 * duration);
      const b = undampedFreq2 * duration + 1;
      return -safeMin + a * b;
    };
    derivative = (undampedFreq2) => {
      const a = Math.exp(-undampedFreq2 * duration);
      const b = -undampedFreq2 * (duration * duration);
      return a * b;
    };
  }
  const initialGuess = 5 / duration;
  const criticalFreq = approximateRoot(envelope, derivative, initialGuess);
  const undampedFreq = criticalFreq * overdampedFreqScale(dampingRatio, criticalFreq * duration);
  const stiffness = undampedFreq * undampedFreq;
  return {
    stiffness,
    damping: dampingRatio * 2 * Math.sqrt(stiffness),
    duration: secondsToMilliseconds(duration)
  };
}
var isValidPhysics = (value, canBeZero) => (canBeZero ? value >= 0 : value > 0) && value < Infinity;
function resolvePhysics(value, canBeZero) {
  if (isValidPhysics(value, canBeZero))
    return value;
  if (true) {
    warning(value === void 0, "Spring stiffness and mass must be positive, damping 0 or greater", "spring-invalid-physics");
  }
  return void 0;
}
function getSpringOptions(options) {
  const validStiffness = resolvePhysics(options.stiffness);
  const validDamping = resolvePhysics(options.damping, true);
  const validMass = resolvePhysics(options.mass);
  const springOptions = {
    ...options,
    stiffness: validStiffness ?? springDefaults.stiffness,
    damping: validDamping ?? springDefaults.damping,
    mass: validMass ?? springDefaults.mass,
    isResolvedFromDuration: false,
    // stiffness/damping/mass overrides duration/bounce
    isTimeDefined: (validStiffness ?? validDamping ?? validMass) === void 0 && (options.duration !== void 0 || options.bounce !== void 0)
  };
  if (springOptions.isTimeDefined) {
    if (options.visualDuration) {
      const dampingRatio = bounceToDampingRatio(options.bounce || 0);
      const root2 = 2 * Math.PI / (options.visualDuration * 1.2) * overdampedFreqScale(dampingRatio, 2 * Math.PI / 1.2);
      springOptions.stiffness = root2 * root2;
      springOptions.damping = 2 * dampingRatio * Math.sqrt(springOptions.stiffness);
    } else {
      Object.assign(springOptions, findSpring(springOptions));
      springOptions.isResolvedFromDuration = true;
    }
    if (!isValidPhysics(springOptions.stiffness) || !isValidPhysics(springOptions.damping, true)) {
      springOptions.stiffness = springDefaults.stiffness;
      springOptions.damping = springDefaults.damping;
    }
  }
  return springOptions;
}
function spring(optionsOrVisualDuration = springDefaults.visualDuration, bounce = springDefaults.bounce) {
  const options = typeof optionsOrVisualDuration !== "object" ? {
    visualDuration: optionsOrVisualDuration,
    keyframes: [0, 1],
    bounce
  } : optionsOrVisualDuration;
  const origin = options.keyframes[0];
  const target = options.keyframes[options.keyframes.length - 1];
  const state = { done: false, value: origin };
  const { stiffness, damping, mass, duration, isResolvedFromDuration, isTimeDefined } = getSpringOptions({ ...options });
  const inheritVelocity = (velocity) => isTimeDefined ? 0 : -millisecondsToSeconds(velocity);
  const dampingRatio = damping / (2 * Math.sqrt(stiffness * mass));
  const undampedAngularFreq = millisecondsToSeconds(Math.sqrt(stiffness / mass));
  const decay = dampingRatio * undampedAngularFreq;
  const s = {
    target,
    delta: target - origin,
    velocity: inheritVelocity(options.velocity || 0) || 0,
    restSpeed: 0,
    restDelta: 0
  };
  const setRestThresholds = () => {
    const isGranularScale = Math.abs(s.delta) < 5;
    s.restSpeed = options.restSpeed || (isGranularScale ? springDefaults.restSpeed.granular : springDefaults.restSpeed.default);
    s.restDelta = options.restDelta || (isGranularScale ? springDefaults.restDelta.granular : springDefaults.restDelta.default);
  };
  setRestThresholds();
  let resolveSpring;
  let resolveVelocity;
  let update;
  if (dampingRatio < 1) {
    const angularFreq = calcAngularFreq(undampedAngularFreq, dampingRatio);
    const c = { A: 0, sinC: 0, cosC: 0, t: -1, env: 0, sin: 0, cos: 0 };
    update = () => {
      c.A = (s.velocity + decay * s.delta) / angularFreq;
      c.sinC = decay * c.A + s.delta * angularFreq;
      c.cosC = decay * s.delta - c.A * angularFreq;
    };
    const sample = (t) => {
      if (t !== c.t) {
        c.t = t;
        c.env = Math.exp(-decay * t);
        c.sin = Math.sin(angularFreq * t);
        c.cos = Math.cos(angularFreq * t);
      }
    };
    resolveSpring = (t) => {
      sample(t);
      return s.target - c.env * (c.A * c.sin + s.delta * c.cos);
    };
    resolveVelocity = (t) => {
      sample(t);
      return c.env * (c.sinC * c.sin + c.cosC * c.cos);
    };
  } else if (dampingRatio === 1) {
    resolveSpring = (t) => s.target - Math.exp(-undampedAngularFreq * t) * (s.delta + (s.velocity + undampedAngularFreq * s.delta) * t);
    const c = { C: 0 };
    update = () => {
      c.C = s.velocity + undampedAngularFreq * s.delta;
    };
    resolveVelocity = (t) => Math.exp(-undampedAngularFreq * t) * (undampedAngularFreq * c.C * t - s.velocity);
  } else {
    const dampedAngularFreq = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1);
    const slow = decay - dampedAngularFreq;
    const fast = decay + dampedAngularFreq;
    const limit = isTimeDefined ? Infinity : 300 / dampedAngularFreq;
    const decayAt = (rate, t) => Math.exp(t > limit ? -rate * limit - decay * (t - limit) : -rate * t);
    const c = { S: 0, F: 0 };
    update = () => {
      const P = (s.velocity + decay * s.delta) / dampedAngularFreq;
      c.S = (s.delta + P) / 2;
      c.F = (s.delta - P) / 2;
    };
    resolveSpring = (t) => s.target - c.S * decayAt(slow, t) - c.F * decayAt(fast, t);
    resolveVelocity = (t) => slow * c.S * decayAt(slow, t) + fast * c.F * decayAt(fast, t);
  }
  update();
  const calculatedDuration = isResolvedFromDuration ? duration || null : null;
  const generator = {
    calculatedDuration,
    /**
     * Aim the spring at a new target from its current position and
     * velocity, reusing the resolved physics and closures.
     */
    retarget: (keyframes2, newVelocity) => {
      s.target = keyframes2[keyframes2.length - 1];
      s.delta = s.target - keyframes2[0];
      s.velocity = inheritVelocity(newVelocity);
      if (!(options.restSpeed && options.restDelta))
        setRestThresholds();
      generator.calculatedDuration = calculatedDuration;
      state.done = false;
      update();
    },
    velocity: (t) => secondsToMilliseconds(resolveVelocity(t)),
    next: (t) => {
      const current = resolveSpring(t);
      if (!isResolvedFromDuration) {
        const currentVelocity = secondsToMilliseconds(resolveVelocity(t));
        state.done = Math.abs(currentVelocity) <= s.restSpeed && Math.abs(s.target - current) <= s.restDelta;
      } else {
        state.done = t >= duration;
      }
      state.value = state.done ? s.target : current;
      return state;
    },
    toString: () => {
      const easingDuration = Math.min(calcGeneratorDuration(generator), maxGeneratorDuration);
      const easing = generateLinearEasing((progress2) => generator.next(easingDuration * progress2).value, easingDuration, 30);
      return easingDuration + "ms " + easing;
    },
    toTransition: () => {
    }
  };
  return generator;
}
spring.applyToOptions = (options) => {
  const generatorOptions = createGeneratorEasing(options, 100, spring);
  options.ease = generatorOptions.ease;
  options.duration = secondsToMilliseconds(generatorOptions.duration);
  options.type = "keyframes";
  return options;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/inertia.mjs
function inertia({ keyframes: keyframes2, velocity = 0, power = 0.8, timeConstant = 325, bounceDamping = 10, bounceStiffness = 500, modifyTarget, min, max, restDelta = 0.5, restSpeed }) {
  const origin = keyframes2[0];
  const state = {
    done: false,
    value: origin
  };
  const isOutOfBounds = (v) => v < min || v > max;
  const nearestBoundary = (v) => {
    if (min === void 0)
      return max;
    if (max === void 0)
      return min;
    return Math.abs(min - v) < Math.abs(max - v) ? min : max;
  };
  let amplitude = power * velocity;
  const ideal = origin + amplitude;
  const target = modifyTarget === void 0 ? ideal : modifyTarget(ideal);
  if (target !== ideal)
    amplitude = target - origin;
  const calcDelta = (t) => -amplitude * Math.exp(-t / timeConstant);
  const applyFriction = (t) => {
    const delta = calcDelta(t);
    state.done = Math.abs(delta) <= restDelta;
    state.value = state.done ? target : target + delta;
  };
  let timeReachedBoundary;
  let spring$1;
  const checkCatchBoundary = (t) => {
    if (!isOutOfBounds(state.value))
      return;
    timeReachedBoundary = t;
    spring$1 = spring({
      keyframes: [state.value, nearestBoundary(state.value)],
      /**
       * The friction curve is target + calcDelta(t), so its exact
       * derivative is -calcDelta(t) / timeConstant in units/ms,
       * converted here to the units/second expected by spring.
       */
      velocity: -calcDelta(t) / timeConstant * 1e3,
      damping: bounceDamping,
      stiffness: bounceStiffness,
      restDelta,
      restSpeed
    });
  };
  checkCatchBoundary(0);
  return {
    calculatedDuration: null,
    next: (t) => {
      let hasUpdatedFrame = false;
      if (!spring$1 && timeReachedBoundary === void 0) {
        hasUpdatedFrame = true;
        applyFriction(t);
        checkCatchBoundary(t);
      }
      if (timeReachedBoundary !== void 0 && t >= timeReachedBoundary) {
        return spring$1.next(t - timeReachedBoundary);
      } else {
        !hasUpdatedFrame && applyFriction(t);
        return state;
      }
    }
  };
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/interpolate.mjs
function createMixers(output, ease2, customMixer) {
  const mixers = [];
  const mixerFactory = customMixer || MotionGlobalConfig.mix || mix;
  const numMixers = output.length - 1;
  for (let i = 0; i < numMixers; i++) {
    let mixer = mixerFactory(output[i], output[i + 1]);
    if (ease2) {
      const easingFunction = Array.isArray(ease2) ? ease2[i] || noop : ease2;
      mixer = pipe(easingFunction, mixer);
    }
    mixers.push(mixer);
  }
  return mixers;
}
function interpolate(input, output, { clamp: isClamp = true, ease: ease2, mixer } = {}) {
  const inputLength = input.length;
  invariant(inputLength === output.length, "Both input and output ranges must be the same length", "range-length");
  if (inputLength === 1)
    return () => output[0];
  if (inputLength === 2 && output[0] === output[1])
    return () => output[1];
  const isZeroDeltaRange = input[0] === input[1];
  if (input[0] > input[inputLength - 1]) {
    input = [...input].reverse();
    output = [...output].reverse();
  }
  const mixers = createMixers(output, ease2, mixer);
  const numMixers = mixers.length;
  const interpolator = (v) => {
    if (isZeroDeltaRange && v < input[0])
      return output[0];
    let i = 0;
    if (numMixers > 1) {
      for (; i < input.length - 2; i++) {
        if (v < input[i + 1])
          break;
      }
    }
    const progressInRange = progress(input[i], input[i + 1], v);
    return mixers[i](progressInRange);
  };
  return isClamp ? (v) => interpolator(clamp(input[0], input[inputLength - 1], v)) : interpolator;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/offsets/fill.mjs
function fillOffset(offset, remaining) {
  const min = offset[offset.length - 1];
  for (let i = 1; i <= remaining; i++) {
    const offsetProgress = progress(0, remaining, i);
    offset.push(mixNumber(min, 1, offsetProgress));
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/offsets/default.mjs
function defaultOffset(arr) {
  const offset = [0];
  fillOffset(offset, arr.length - 1);
  return offset;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/offsets/time.mjs
function convertOffsetToTimes(offset, duration) {
  return offset.map((o) => o * duration);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/keyframes.mjs
function defaultEasing(values, easing) {
  return values.map(() => easing || easeInOut).splice(0, values.length - 1);
}
function keyframes({ duration = 300, keyframes: keyframeValues, times, ease: ease2 = "easeInOut" }) {
  const easingFunctions = isEasingArray(ease2) ? ease2.map(easingDefinitionToFunction) : easingDefinitionToFunction(ease2) || easeInOut;
  const state = {
    done: false,
    value: keyframeValues[0]
  };
  if (keyframeValues.length === 2 && !Array.isArray(easingFunctions) && (!times || times.length !== 2 || times[0] === 0 && times[1] === 1)) {
    const [origin, target] = keyframeValues;
    const mixer = origin === target ? void 0 : (MotionGlobalConfig.mix || mix)(origin, target);
    return {
      calculatedDuration: duration,
      next: (t) => {
        state.value = mixer ? mixer(easingFunctions(duration > 0 ? clamp(0, 1, t / duration) : 1)) : target;
        state.done = t >= duration;
        return state;
      }
    };
  }
  const absoluteTimes = convertOffsetToTimes(
    // Only use the provided offsets if they're the correct length
    // TODO Maybe we should warn here if there's a length mismatch
    times && times.length === keyframeValues.length ? times : defaultOffset(keyframeValues),
    duration
  );
  const mapTimeToKeyframe = interpolate(absoluteTimes, keyframeValues, {
    ease: Array.isArray(easingFunctions) ? easingFunctions : defaultEasing(keyframeValues, easingFunctions)
  });
  return {
    calculatedDuration: duration,
    next: (t) => {
      state.value = mapTimeToKeyframe(t);
      state.done = t >= duration;
      return state;
    }
  };
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/utils/velocity.mjs
var velocitySampleDuration = 5;
function getGeneratorVelocity(resolveValue, t, current) {
  const prevT = Math.max(t - velocitySampleDuration, 0);
  return velocityPerSecond(current - resolveValue(prevT), t - prevT);
}
function calcGeneratorVelocity(generator, t, initialVelocity = 0) {
  if (t <= 0)
    return initialVelocity;
  return generator.velocity ? generator.velocity(t) : getGeneratorVelocity((s) => generator.next(s).value, t, generator.next(t).value);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/get-final.mjs
var isNotNull = (value) => value !== null;
function getFinalKeyframe(keyframes2, { repeat, repeatType = "loop" }, finalKeyframe, speed = 1) {
  const resolvedKeyframes = keyframes2.filter(isNotNull);
  const useFirstKeyframe = speed < 0 || repeat && repeatType !== "loop" && repeat % 2 === 1;
  const index = useFirstKeyframe ? 0 : resolvedKeyframes.length - 1;
  return !index || finalKeyframe === void 0 ? resolvedKeyframes[index] : finalKeyframe;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/replace-transition-type.mjs
var transitionTypeMap = {
  decay: inertia,
  inertia,
  tween: keyframes,
  keyframes,
  spring
};
function replaceTransitionType(transition) {
  if (typeof transition.type === "string") {
    transition.type = transitionTypeMap[transition.type];
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/resolve-start-time.mjs
var MAX_START_DELAY = 40;
var resolveStartTime = (startTime, now2) => now2 - startTime > MAX_START_DELAY && !MotionGlobalConfig.useManualTiming ? now2 : startTime;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/notify-inspector.mjs
function baseRecord(kind, animation) {
  return {
    kind,
    animation,
    timestamp: time.now(),
    frameTimestamp: frameData.timestamp,
    frameIsProcessing: frameData.isProcessing
  };
}
function notifyAnimationStart(animation, options, transition) {
  const notify = globalThis.__MOTION_INSPECT__;
  if (!notify)
    return;
  try {
    notify({
      ...baseRecord("animation-start", animation),
      options: transition ? { ...options, ...transition } : options
    });
  } catch {
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/WithPromise.mjs
var WithPromise = class {
  constructor() {
    this.isResolved = false;
  }
  get finished() {
    if (!this._finished) {
      this._finished = this.isResolved ? Promise.resolve() : new Promise((resolve) => {
        this._resolve = resolve;
      });
    }
    return this._finished;
  }
  updateFinished() {
    this._finished = this._resolve = void 0;
    this.isResolved = false;
  }
  notifyFinished() {
    this.isResolved = true;
    this._resolve?.();
  }
  /**
   * Allows the animation to be awaited.
   *
   * @deprecated Use `finished` instead.
   */
  then(onResolve, onReject) {
    return this.finished.then(onResolve, onReject);
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/JSAnimation.mjs
var percentToProgress = (percent2) => percent2 / 100;
var round = (value) => Math.round(value * 1e4) / 1e4;
var JSAnimation = class extends WithPromise {
  constructor(options) {
    super();
    this.state = "idle";
    this.startTime = null;
    this.isStopped = false;
    this.currentTime = 0;
    this.holdTime = null;
    this.playbackSpeed = 1;
    this.delayState = {
      done: false,
      value: void 0
    };
    this.stop = () => {
      const { motionValue: motionValue2 } = this.options;
      if (motionValue2 && motionValue2.updatedAt !== time.now()) {
        this.tick(time.now());
      }
      this.isStopped = true;
      if (this.state === "idle")
        return;
      this.teardown();
      this.options.onStop?.();
    };
    this.options = options;
    this.initAnimation();
    this.play();
    if (options.autoplay === false)
      this.pause();
    notifyAnimationStart(this, this.options);
  }
  initAnimation() {
    const { options } = this;
    replaceTransitionType(options);
    const { type = keyframes, repeat = 0, repeatDelay = 0, repeatType, velocity = 0 } = options;
    let { keyframes: keyframes$1 } = options;
    const generatorFactory = type || keyframes;
    if (generatorFactory !== keyframes) {
      invariant(keyframes$1.length <= 2, `Only two keyframes currently supported with spring and inertia animations. Trying to animate ${keyframes$1}`, "spring-two-frames");
    }
    if (generatorFactory !== keyframes && typeof keyframes$1[0] !== "number") {
      this.mixKeyframes = pipe(percentToProgress, mix(keyframes$1[0], keyframes$1[1]));
      keyframes$1 = [0, 100];
    }
    const generator = generatorFactory(keyframes$1 === options.keyframes ? options : { ...options, keyframes: keyframes$1 });
    if (repeatType === "mirror") {
      this.mirroredGenerator = generatorFactory({
        ...options,
        keyframes: [...keyframes$1].reverse(),
        velocity: -velocity
      });
    }
    if (generator.calculatedDuration === null) {
      generator.calculatedDuration = calcGeneratorDuration(generator);
    }
    const { calculatedDuration } = generator;
    this.calculatedDuration = calculatedDuration;
    this.resolvedDuration = calculatedDuration + repeatDelay;
    this.totalDuration = this.resolvedDuration * (repeat + 1) - repeatDelay;
    this.generator = generator;
  }
  updateTime(timestamp) {
    const animationTime = Math.round(timestamp - this.startTime) * this.playbackSpeed;
    if (this.holdTime !== null) {
      this.currentTime = this.holdTime;
    } else {
      this.currentTime = animationTime;
    }
  }
  tick(timestamp, sample = false) {
    const { generator, totalDuration, calculatedDuration } = this;
    if (this.startTime === null)
      return generator.next(0);
    const { delay = 0, keyframes: keyframes2, type, onUpdate, finalKeyframe } = this.options;
    if (this.startTime === this.pendingStartTime) {
      this.startTime = resolveStartTime(this.startTime, timestamp);
    }
    this.pendingStartTime = void 0;
    if (this.speed > 0) {
      this.startTime = Math.min(this.startTime, timestamp);
    } else if (this.speed < 0) {
      this.startTime = Math.min(timestamp - totalDuration / this.speed, this.startTime);
    }
    if (sample) {
      this.currentTime = timestamp;
    } else {
      this.updateTime(timestamp);
    }
    const timeWithoutDelay = this.currentTime - delay * (this.playbackSpeed >= 0 ? 1 : -1);
    const isInDelayPhase = this.playbackSpeed >= 0 ? timeWithoutDelay < 0 : timeWithoutDelay > totalDuration;
    this.currentTime = Math.max(timeWithoutDelay, 0);
    if (this.state === "finished" && this.holdTime === null) {
      this.currentTime = totalDuration;
    }
    const state = this.generate(this.currentTime, isInDelayPhase);
    let { done } = state;
    if (!isInDelayPhase && calculatedDuration !== null) {
      done = this.playbackSpeed >= 0 ? this.currentTime >= totalDuration : this.currentTime <= 0;
    }
    const isAnimationFinished = this.holdTime === null && (this.state === "finished" || this.state === "running" && done);
    if (isAnimationFinished && type !== inertia) {
      state.value = getFinalKeyframe(keyframes2, this.options, finalKeyframe, this.speed);
    }
    if (onUpdate) {
      onUpdate(state.value);
    }
    if (isAnimationFinished) {
      this.finish();
    }
    return state;
  }
  /**
   * This animation's time, including delay, at a timestamp.
   */
  at(timestamp) {
    return this.holdTime ?? round((timestamp - this.startTime) * this.playbackSpeed);
  }
  /**
   * The value at a timestamp, without changing this animation's state.
   * If resolved, it ends at the last resolved keyframe, which is in the
   * same unit as the others, rather than at finalKeyframe.
   */
  sampleAt(timestamp, resolved) {
    const { options, totalDuration } = this;
    const t = this.at(timestamp) - (options.delay || 0);
    return t >= totalDuration && options.type !== inertia ? getFinalKeyframe(options.keyframes, options, resolved ? void 0 : options.finalKeyframe) : this.generate(Math.max(t, 0), t < 0).value;
  }
  /**
   * The generator's state `currentTime` ms after the delay, without
   * changing the animation's own state.
   */
  generate(currentTime, isInDelayPhase) {
    const { generator, totalDuration, mixKeyframes, mirroredGenerator, resolvedDuration } = this;
    const { keyframes: keyframes2, repeat, repeatType, repeatDelay } = this.options;
    let elapsed = currentTime;
    let frameGenerator = generator;
    if (repeat) {
      const progress2 = Math.min(currentTime, totalDuration) / resolvedDuration;
      let currentIteration = Math.floor(progress2);
      let iterationProgress = progress2 % 1;
      if (!iterationProgress && progress2 >= 1) {
        iterationProgress = 1;
      }
      iterationProgress === 1 && currentIteration--;
      currentIteration = Math.min(currentIteration, repeat + 1);
      const isOddIteration = Boolean(currentIteration % 2);
      if (isOddIteration) {
        if (repeatType === "reverse") {
          iterationProgress = 1 - iterationProgress;
          if (repeatDelay) {
            iterationProgress -= repeatDelay / resolvedDuration;
          }
        } else if (repeatType === "mirror") {
          frameGenerator = mirroredGenerator;
        }
      }
      elapsed = clamp(0, 1, iterationProgress) * resolvedDuration;
    }
    let state;
    if (isInDelayPhase) {
      this.delayState.value = keyframes2[0];
      state = this.delayState;
    } else {
      state = frameGenerator.next(elapsed);
    }
    if (mixKeyframes && !isInDelayPhase) {
      state.value = mixKeyframes(state.value);
    }
    return state;
  }
  /**
   * Allows the returned animation to be awaited or promise-chained. Currently
   * resolves when the animation finishes at all but in a future update could/should
   * reject if its cancels.
   */
  then(resolve, reject) {
    return this.finished.then(resolve, reject);
  }
  get duration() {
    return millisecondsToSeconds(this.calculatedDuration);
  }
  get iterationDuration() {
    const { delay = 0 } = this.options || {};
    return this.duration + millisecondsToSeconds(delay);
  }
  get time() {
    return millisecondsToSeconds(this.currentTime);
  }
  set time(newTime) {
    newTime = secondsToMilliseconds(newTime);
    this.currentTime = newTime;
    if (this.startTime === null || this.holdTime !== null || this.playbackSpeed === 0) {
      this.holdTime = newTime;
    } else if (this.driver) {
      this.startTime = this.driver.now() - newTime / this.playbackSpeed;
    }
    if (this.driver) {
      this.driver.start(false);
    } else {
      this.startTime = 0;
      this.state = "paused";
      this.holdTime = newTime;
      this.tick(newTime);
    }
  }
  /**
   * Returns the generator's velocity at the current time in units/second.
   * Uses the analytical derivative when available (springs), avoiding
   * the MotionValue's frame-dependent velocity estimation.
   */
  getGeneratorVelocity() {
    return calcGeneratorVelocity(this.generator, this.currentTime, this.options.velocity);
  }
  get speed() {
    return this.playbackSpeed;
  }
  set speed(newSpeed) {
    const hasChanged = this.playbackSpeed !== newSpeed;
    if (hasChanged && this.driver) {
      this.updateTime(time.now());
    }
    this.playbackSpeed = newSpeed;
    if (hasChanged && this.driver) {
      this.time = millisecondsToSeconds(this.currentTime);
    }
  }
  play() {
    if (this.isStopped)
      return;
    const { driver = frameloopDriver, startTime } = this.options;
    if (!this.driver) {
      this.driver = driver((timestamp) => this.tick(timestamp));
    }
    this.options.onPlay?.();
    const now2 = this.driver.now();
    if (this.state === "finished") {
      this.updateFinished();
      this.startTime = now2;
    } else if (this.holdTime !== null) {
      this.startTime = now2 - this.holdTime / (this.playbackSpeed || 1);
    } else if (!this.startTime) {
      this.startTime = startTime ?? (this.pendingStartTime = now2);
    }
    if (this.state === "finished" && this.speed < 0) {
      this.startTime += this.calculatedDuration;
    }
    this.holdTime = null;
    this.state = "running";
    this.driver.start();
  }
  pause() {
    this.state = "paused";
    this.updateTime(time.now());
    this.holdTime = this.currentTime;
  }
  complete() {
    if (this.state !== "running") {
      this.play();
    }
    this.state = "finished";
    this.holdTime = null;
  }
  finish() {
    this.notifyFinished();
    this.teardown();
    this.state = "finished";
    this.options.onComplete?.();
  }
  cancel() {
    this.holdTime = null;
    this.startTime = 0;
    this.tick(0);
    this.teardown();
    this.options.onCancel?.();
  }
  teardown() {
    this.state = "idle";
    this.stopDriver();
    this.startTime = this.holdTime = null;
  }
  stopDriver() {
    if (!this.driver)
      return;
    this.driver.stop();
    this.driver = void 0;
  }
  sample(sampleTime) {
    this.startTime = 0;
    return this.tick(sampleTime, true);
  }
  attachTimeline(timeline) {
    if (this.options.allowFlatten) {
      this.options.type = "keyframes";
      this.options.ease = "linear";
      this.initAnimation();
    }
    this.driver?.stop();
    return timeline.observe(this);
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/complex/filter.mjs
var maxDefaults = /* @__PURE__ */ new Set(["brightness", "contrast", "saturate", "opacity"]);
function applyDefaultFilter(v) {
  const [name, value] = v.slice(0, -1).split("(");
  if (name === "drop-shadow")
    return v;
  const [number2] = value.match(floatRegex) || [];
  if (!number2)
    return v;
  const unit = value.replace(number2, "");
  let defaultValue = maxDefaults.has(name) ? 1 : 0;
  if (number2 !== value)
    defaultValue *= 100;
  return name + "(" + defaultValue + unit + ")";
}
var functionRegex = /\b([a-z-]*)\(.*?\)/gu;
var filter = {
  ...complex,
  getAnimatableNone: (v) => {
    const functions = v.match(functionRegex);
    return functions ? functions.map(applyDefaultFilter).join(" ") : v;
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/complex/mask.mjs
var mask = {
  ...complex,
  getAnimatableNone: (v) => {
    const parsed = complex.parse(v);
    const transformer = complex.createTransformer(v);
    return transformer(parsed.map((v2) => typeof v2 === "number" ? 0 : typeof v2 === "object" ? { ...v2, alpha: 1 } : v2));
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/int.mjs
var int = {
  ...number,
  transform: Math.round
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/maps/transform.mjs
var transformValueTypes = {
  rotate: degrees,
  /**
   * Internal channel for `transition.path` orientToPath. Composed onto
   * `rotate` at the transform-build sites so the user's `rotate` is
   * never read or overwritten. Not part of `transformPropOrder`.
   */
  pathRotation: degrees,
  rotateX: degrees,
  rotateY: degrees,
  rotateZ: degrees,
  scale,
  scaleX: scale,
  scaleY: scale,
  scaleZ: scale,
  skew: degrees,
  skewX: degrees,
  skewY: degrees,
  distance: px,
  translateX: px,
  translateY: px,
  translateZ: px,
  x: px,
  y: px,
  z: px,
  perspective: px,
  transformPerspective: px,
  opacity: alpha,
  originX: progressPercentage,
  originY: progressPercentage,
  originZ: px
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/maps/number.mjs
var numberValueTypes = {
  // Border props
  borderWidth: px,
  borderTopWidth: px,
  borderRightWidth: px,
  borderBottomWidth: px,
  borderLeftWidth: px,
  borderRadius: px,
  borderTopLeftRadius: px,
  borderTopRightRadius: px,
  borderBottomRightRadius: px,
  borderBottomLeftRadius: px,
  // Positioning props
  width: px,
  maxWidth: px,
  height: px,
  maxHeight: px,
  top: px,
  right: px,
  bottom: px,
  left: px,
  inset: px,
  insetBlock: px,
  insetBlockStart: px,
  insetBlockEnd: px,
  insetInline: px,
  insetInlineStart: px,
  insetInlineEnd: px,
  // Spacing props
  padding: px,
  paddingTop: px,
  paddingRight: px,
  paddingBottom: px,
  paddingLeft: px,
  paddingBlock: px,
  paddingBlockStart: px,
  paddingBlockEnd: px,
  paddingInline: px,
  paddingInlineStart: px,
  paddingInlineEnd: px,
  margin: px,
  marginTop: px,
  marginRight: px,
  marginBottom: px,
  marginLeft: px,
  marginBlock: px,
  marginBlockStart: px,
  marginBlockEnd: px,
  marginInline: px,
  marginInlineStart: px,
  marginInlineEnd: px,
  // Typography
  fontSize: px,
  // Misc
  backgroundPositionX: px,
  backgroundPositionY: px,
  ...transformValueTypes,
  zIndex: int,
  // SVG
  fillOpacity: alpha,
  strokeOpacity: alpha,
  numOctaves: int
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/maps/defaults.mjs
var defaultValueTypes = {
  ...numberValueTypes,
  // Color props
  color,
  backgroundColor: color,
  outlineColor: color,
  fill: color,
  stroke: color,
  // Border props
  borderColor: color,
  borderTopColor: color,
  borderRightColor: color,
  borderBottomColor: color,
  borderLeftColor: color,
  filter,
  WebkitFilter: filter,
  mask,
  WebkitMask: mask
};
var getDefaultValueType = (key) => defaultValueTypes[key];

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/animatable-none.mjs
var customTypes = /* @__PURE__ */ new Set([filter, mask]);
function getAnimatableNone2(key, value) {
  let defaultValueType = getDefaultValueType(key);
  if (!customTypes.has(defaultValueType))
    defaultValueType = complex;
  return defaultValueType.getAnimatableNone ? defaultValueType.getAnimatableNone(value) : void 0;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/utils/fill-wildcards.mjs
function fillWildcards(keyframes2) {
  for (let i = 1; i < keyframes2.length; i++) {
    keyframes2[i] ?? (keyframes2[i] = keyframes2[i - 1]);
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/dom/parse-transform.mjs
var radToDeg = (rad) => rad * 180 / Math.PI;
var rotate = (v) => {
  const angle = radToDeg(Math.atan2(v[1], v[0]));
  return rebaseAngle(angle);
};
var matrix2dParsers = {
  x: 4,
  y: 5,
  translateX: 4,
  translateY: 5,
  scaleX: 0,
  scaleY: 3,
  scaleZ: () => 1,
  scale: (v) => (Math.abs(v[0]) + Math.abs(v[3])) / 2,
  rotate,
  rotateZ: rotate,
  skewX: (v) => radToDeg(Math.atan(v[1])),
  skewY: (v) => radToDeg(Math.atan(v[2])),
  skew: (v) => (Math.abs(v[1]) + Math.abs(v[2])) / 2
};
var rebaseAngle = (angle) => {
  angle = angle % 360;
  if (angle < 0)
    angle += 360;
  return angle;
};
var rotateZ = rotate;
var scaleX = (v) => Math.hypot(v[0], v[1]);
var scaleY = (v) => Math.hypot(v[4], v[5]);
var matrix3dParsers = {
  x: 12,
  y: 13,
  z: 14,
  translateX: 12,
  translateY: 13,
  translateZ: 14,
  scaleX,
  scaleY,
  scaleZ: (v) => Math.hypot(v[8], v[9], v[10]),
  scale: (v) => (scaleX(v) + scaleY(v)) / 2,
  rotateX: (v) => rebaseAngle(radToDeg(Math.atan2(v[6], v[5]))),
  rotateY: (v) => rebaseAngle(radToDeg(Math.atan2(-v[2], v[0]))),
  rotateZ,
  rotate: rotateZ,
  skewX: (v) => radToDeg(Math.atan(v[4])),
  skewY: (v) => radToDeg(Math.atan(v[1])),
  skew: (v) => (Math.abs(v[1]) + Math.abs(v[4])) / 2
};
function defaultTransformValue(name) {
  return name.includes("scale") ? 1 : 0;
}
function parseValueFromTransform(transform, name) {
  if (!transform || transform === "none") {
    return defaultTransformValue(name);
  }
  const matrix3dMatch = transform.match(/^matrix3d\(([-\d.e\s,]+)\)$/u);
  let parsers;
  let match;
  if (matrix3dMatch) {
    parsers = matrix3dParsers;
    match = matrix3dMatch;
  } else {
    const matrix2dMatch = transform.match(/^matrix\(([-\d.e\s,]+)\)$/u);
    parsers = matrix2dParsers;
    match = matrix2dMatch;
  }
  if (!match) {
    return defaultTransformValue(name);
  }
  const valueParser = parsers[name];
  const values = match[1].split(",").map(convertTransformToNumber);
  return typeof valueParser === "function" ? valueParser(values) : values[valueParser];
}
var readTransformValue = (instance, name) => {
  const { transform = "none" } = getComputedStyle(instance);
  return parseValueFromTransform(transform, name);
};
function convertTransformToNumber(value) {
  return parseFloat(value.trim());
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/utils/keys-transform.mjs
var transformPropOrder = [
  "transformPerspective",
  "x",
  "y",
  "z",
  "translateX",
  "translateY",
  "translateZ",
  "scale",
  "scaleX",
  "scaleY",
  "scaleZ",
  "rotate",
  "rotateX",
  "rotateY",
  "rotateZ",
  "skew",
  "skewX",
  "skewY"
];
var transformProps = /* @__PURE__ */ (() => /* @__PURE__ */ new Set([...transformPropOrder, "pathRotation"]))();

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/utils/unit-conversion.mjs
var isNumOrPxType = (v) => v === number || v === px;
var transformKeys = /* @__PURE__ */ new Set(["x", "y", "z"]);
var nonTranslationalTransformKeys = transformPropOrder.filter((key) => !transformKeys.has(key));
function removeNonTranslationalTransform(visualElement) {
  const removedTransforms = [];
  nonTranslationalTransformKeys.forEach((key) => {
    const value = visualElement.getValue(key);
    if (value !== void 0) {
      const current = value.get();
      const reset = key.startsWith("scale") ? 1 : 0;
      if (current === reset)
        return;
      removedTransforms.push([key, current]);
      value.set(reset);
    }
  });
  return removedTransforms;
}
var boxDependentValues = /* @__PURE__ */ new Set(["bottom", "right"]);
function measureDimension(computed, measureBox, axis, paddingStart, paddingEnd, boxSizing) {
  const px2 = parseFloat(computed);
  if (!isNaN(px2))
    return px2;
  const { min, max } = measureBox()[axis];
  const size = max - min;
  return boxSizing === "border-box" ? size : size - parseFloat(paddingStart) - parseFloat(paddingEnd);
}
var positionalValues = {
  // Dimensions
  width: ({ width, paddingLeft = "0", paddingRight = "0", boxSizing }, measureBox) => measureDimension(width, measureBox, "x", paddingLeft, paddingRight, boxSizing),
  height: ({ height, paddingTop = "0", paddingBottom = "0", boxSizing }, measureBox) => measureDimension(height, measureBox, "y", paddingTop, paddingBottom, boxSizing),
  top: ({ top }) => parseFloat(top),
  left: ({ left }) => parseFloat(left),
  bottom: ({ top }, measureBox) => {
    const { y } = measureBox();
    return parseFloat(top) + (y.max - y.min);
  },
  right: ({ left }, measureBox) => {
    const { x } = measureBox();
    return parseFloat(left) + (x.max - x.min);
  },
  // Transform
  x: ({ transform }) => parseValueFromTransform(transform, "x"),
  y: ({ transform }) => parseValueFromTransform(transform, "y")
};
positionalValues.translateX = positionalValues.x;
positionalValues.translateY = positionalValues.y;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/KeyframesResolver.mjs
var toResolve = /* @__PURE__ */ new Set();
var isScheduled = false;
var anyNeedsMeasurement = false;
var isForced = false;
function measureAllKeyframes() {
  if (anyNeedsMeasurement) {
    const resolversToMeasure = [];
    const elementsToMeasure = /* @__PURE__ */ new Set();
    const elementsToUntransform = /* @__PURE__ */ new Set();
    toResolve.forEach((resolver) => {
      if (!resolver.needsMeasurement)
        return;
      resolversToMeasure.push(resolver);
      elementsToMeasure.add(resolver.element);
      if (boxDependentValues.has(resolver.name)) {
        elementsToUntransform.add(resolver.element);
      }
    });
    const transformsToRestore = /* @__PURE__ */ new Map();
    elementsToUntransform.forEach((element) => {
      const removedTransforms = removeNonTranslationalTransform(element);
      if (!removedTransforms.length)
        return;
      transformsToRestore.set(element, removedTransforms);
      element.render();
    });
    resolversToMeasure.forEach((resolver) => resolver.measureInitialState());
    elementsToMeasure.forEach((element) => {
      element.render();
      const restore = transformsToRestore.get(element);
      if (restore) {
        restore.forEach(([key, value]) => {
          element.getValue(key)?.set(value);
        });
      }
    });
    resolversToMeasure.forEach((resolver) => resolver.measureEndState());
    resolversToMeasure.forEach((resolver) => {
      if (resolver.suspendedScrollY !== void 0) {
        window.scrollTo(0, resolver.suspendedScrollY);
      }
    });
  }
  anyNeedsMeasurement = false;
  isScheduled = false;
  toResolve.forEach((resolver) => resolver.complete(isForced));
  toResolve.clear();
}
function readAllKeyframes() {
  toResolve.forEach((resolver) => {
    resolver.readKeyframes();
    if (resolver.needsMeasurement) {
      anyNeedsMeasurement = true;
    }
  });
}
function flushKeyframeResolvers() {
  isForced = true;
  readAllKeyframes();
  measureAllKeyframes();
  isForced = false;
}
function readOrigin(value, name, target) {
  if (typeof value === "string") {
    if (isNumericalString(value) || isZeroValueString(value)) {
      return parseFloat(value);
    } else if (!complex.test(value) && complex.test(target)) {
      return getAnimatableNone2(name, target);
    }
  }
  return value ?? void 0;
}
var KeyframeResolver = class {
  constructor(unresolvedKeyframes, onComplete, name, motionValue2, element, isAsync = false) {
    this.state = "pending";
    this.isAsync = false;
    this.needsMeasurement = false;
    this.unresolvedKeyframes = [...unresolvedKeyframes];
    this.onComplete = onComplete;
    this.name = name;
    this.motionValue = motionValue2;
    this.element = element;
    this.isAsync = isAsync;
  }
  scheduleResolve() {
    this.state = "scheduled";
    if (this.isAsync) {
      toResolve.add(this);
      if (!isScheduled) {
        isScheduled = true;
        frame.read(readAllKeyframes);
        frame.resolveKeyframes(measureAllKeyframes);
      }
    } else {
      this.readKeyframes();
      this.complete();
    }
  }
  readKeyframes() {
    const { unresolvedKeyframes, name, element, motionValue: motionValue2 } = this;
    if (unresolvedKeyframes[0] === null) {
      const currentValue = motionValue2?.get();
      const finalKeyframe = unresolvedKeyframes[unresolvedKeyframes.length - 1];
      if (currentValue !== void 0) {
        unresolvedKeyframes[0] = currentValue;
      } else if (element && name) {
        const valueAsRead = readOrigin(element.readValue(name, finalKeyframe), name, finalKeyframe);
        if (valueAsRead !== void 0) {
          unresolvedKeyframes[0] = valueAsRead;
        }
      }
      if (unresolvedKeyframes[0] === void 0) {
        unresolvedKeyframes[0] = finalKeyframe;
      }
      if (motionValue2 && currentValue === void 0) {
        motionValue2.set(unresolvedKeyframes[0]);
      }
    }
    fillWildcards(unresolvedKeyframes);
  }
  setFinalKeyframe() {
  }
  measureInitialState() {
  }
  renderEndStyles() {
  }
  measureEndState() {
  }
  complete(isForcedComplete = false) {
    this.state = "complete";
    this.onComplete(this.unresolvedKeyframes, this.finalKeyframe, isForcedComplete);
    toResolve.delete(this);
  }
  cancel() {
    if (this.state === "scheduled") {
      toResolve.delete(this);
      this.state = "pending";
    }
  }
  resume() {
    if (this.state === "pending")
      this.scheduleResolve();
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/dom/is-css-var.mjs
var isCSSVar = (name) => name.startsWith("--");

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/dom/style-set.mjs
function setStyle(element, name, value) {
  isCSSVar(name) ? element.style.setProperty(name, value) : element.style[name] = value;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/supports/flags.mjs
var supportsFlags = {};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/supports/memo.mjs
function memoSupports(callback, supportsFlag) {
  const memoized = memo(callback);
  return () => supportsFlags[supportsFlag] ?? memoized();
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/supports/scroll-timeline.mjs
var supportsScrollTimeline = /* @__PURE__ */ memoSupports(() => window.ScrollTimeline !== void 0, "scrollTimeline");

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/supports/linear-easing.mjs
var supportsLinearEasing = /* @__PURE__ */ memoSupports(() => {
  try {
    document.createElement("div").animate({ opacity: 0 }, { easing: "linear(0, 1)" });
  } catch (e) {
    return false;
  }
  return true;
}, "linearEasing");

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/easing/cubic-bezier.mjs
var cubicBezierAsString = ([a, b, c, d]) => `cubic-bezier(${a}, ${b}, ${c}, ${d})`;

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/easing/supported.mjs
var supportedWaapiEasing = {
  linear: "linear",
  ease: "ease",
  easeIn: "ease-in",
  easeOut: "ease-out",
  easeInOut: "ease-in-out",
  circIn: /* @__PURE__ */ cubicBezierAsString([0, 0.65, 0.55, 1]),
  circOut: /* @__PURE__ */ cubicBezierAsString([0.55, 0, 1, 0.45]),
  backIn: /* @__PURE__ */ cubicBezierAsString([0.31, 0.01, 0.66, -0.59]),
  backOut: /* @__PURE__ */ cubicBezierAsString([0.33, 1.53, 0.69, 0.99])
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/easing/map-easing.mjs
function mapEasingToNativeEasing(easing, duration) {
  if (!easing) {
    return void 0;
  } else if (typeof easing === "function") {
    return supportsLinearEasing() ? generateLinearEasing(easing, duration) : "ease-out";
  } else if (isBezierDefinition(easing)) {
    return cubicBezierAsString(easing);
  } else if (Array.isArray(easing)) {
    return easing.map((segmentEasing) => mapEasingToNativeEasing(segmentEasing, duration) || supportedWaapiEasing.easeOut);
  } else {
    return supportedWaapiEasing[easing];
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/start-waapi-animation.mjs
function startWaapiAnimation(element, valueName, keyframes2, { delay = 0, duration = 300, repeat = 0, repeatType = "loop", ease: ease2 = "easeOut", times } = {}, pseudoElement = void 0) {
  const keyframeOptions = {
    [valueName]: keyframes2
  };
  if (times)
    keyframeOptions.offset = times;
  const easing = mapEasingToNativeEasing(ease2, duration);
  if (Array.isArray(easing))
    keyframeOptions.easing = easing;
  const options = {
    delay,
    duration,
    easing: !Array.isArray(easing) ? easing : "linear",
    fill: "both",
    iterations: repeat + 1,
    direction: repeatType === "reverse" ? "alternate" : "normal"
  };
  if (pseudoElement)
    options.pseudoElement = pseudoElement;
  return element.animate(keyframeOptions, options);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/generators/utils/is-generator.mjs
function isGenerator(type) {
  return typeof type === "function" && "applyToOptions" in type;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/utils/apply-generator.mjs
function applyGeneratorOptions({ type, ...options }) {
  if (isGenerator(type) && supportsLinearEasing()) {
    return type.applyToOptions(options);
  } else {
    options.duration ?? (options.duration = 300);
    options.ease ?? (options.ease = "easeOut");
  }
  return options;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/NativeAnimation.mjs
var NativeAnimation = class extends WithPromise {
  constructor(options) {
    super();
    this.finishedTime = null;
    this.isStopped = false;
    this.manualStartTime = null;
    if (!options)
      return;
    const { element, name, keyframes: keyframes2, pseudoElement, allowFlatten = false, finalKeyframe, onComplete } = options;
    this.isPseudoElement = Boolean(pseudoElement);
    this.allowFlatten = allowFlatten;
    this.options = options;
    invariant(typeof options.type !== "string", `Mini animate() doesn't support "type" as a string.`, "mini-spring");
    const transition = applyGeneratorOptions(options);
    this.animation = startWaapiAnimation(element, name, keyframes2, transition, pseudoElement);
    if (transition.autoplay === false) {
      this.animation.pause();
    }
    this.animation.onfinish = () => {
      this.finishedTime = this.time;
      if (!pseudoElement) {
        const keyframe = getFinalKeyframe(keyframes2, this.options, finalKeyframe, this.speed);
        if (this.updateMotionValue) {
          this.updateMotionValue(keyframe);
        }
        setStyle(element, name, keyframe);
        this.animation.cancel();
      }
      onComplete?.();
      this.notifyFinished();
    };
    notifyAnimationStart(this, options, transition);
  }
  play() {
    if (this.isStopped)
      return;
    this.manualStartTime = null;
    this.animation.play();
    if (this.state === "finished") {
      this.updateFinished();
    }
  }
  pause() {
    this.animation.pause();
  }
  complete() {
    this.animation.finish?.();
  }
  cancel() {
    try {
      this.animation.cancel();
    } catch (e) {
    }
  }
  stop() {
    if (this.isStopped)
      return;
    this.isStopped = true;
    const { state } = this;
    if (state === "idle" || state === "finished") {
      return;
    }
    if (this.updateMotionValue) {
      this.updateMotionValue();
    } else {
      this.commitStyles();
    }
    if (!this.isPseudoElement)
      this.cancel();
  }
  /**
   * WAAPI doesn't natively have any interruption capabilities.
   *
   * In this method, we commit styles back to the DOM before cancelling
   * the animation.
   *
   * This is designed to be overridden by NativeAnimationExtended, which
   * will create a renderless JS animation and sample it twice to calculate
   * its current value, "previous" value, and therefore allow
   * Motion to also correctly calculate velocity for any subsequent animation
   * while deferring the commit until the next animation frame.
   */
  commitStyles() {
    const element = this.options?.element;
    if (!this.isPseudoElement && element?.isConnected) {
      this.animation.commitStyles?.();
    }
  }
  get duration() {
    const duration = this.animation.effect?.getComputedTiming?.().duration || 0;
    return millisecondsToSeconds(Number(duration));
  }
  get iterationDuration() {
    const { delay = 0 } = this.options || {};
    return this.duration + millisecondsToSeconds(delay);
  }
  get time() {
    return millisecondsToSeconds(Number(this.animation.currentTime) || 0);
  }
  set time(newTime) {
    const wasFinished = this.finishedTime !== null;
    this.manualStartTime = null;
    this.finishedTime = null;
    this.animation.currentTime = secondsToMilliseconds(newTime);
    if (wasFinished) {
      this.animation.pause();
    }
  }
  /**
   * The playback speed of the animation.
   * 1 = normal speed, 2 = double speed, 0.5 = half speed.
   */
  get speed() {
    return this.animation.playbackRate;
  }
  set speed(newSpeed) {
    if (newSpeed < 0)
      this.finishedTime = null;
    this.animation.playbackRate = newSpeed;
  }
  get state() {
    return this.finishedTime !== null ? "finished" : this.animation.playState;
  }
  get startTime() {
    return this.manualStartTime ?? Number(this.animation.startTime);
  }
  set startTime(newStartTime) {
    this.manualStartTime = this.animation.startTime = newStartTime;
  }
  /**
   * Attaches a timeline to the animation, for instance the `ScrollTimeline`.
   */
  attachTimeline({ timeline, onAttach, observe }) {
    if (this.allowFlatten) {
      this.animation.effect?.updateTiming({ easing: "linear" });
    }
    this.animation.onfinish = null;
    if (timeline && supportsScrollTimeline()) {
      this.animation.timeline = timeline;
      onAttach?.(this.animation);
      return noop;
    } else {
      return observe(this);
    }
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/utils/unsupported-easing.mjs
var unsupportedEasingFunctions = {
  anticipate,
  backInOut,
  circInOut
};
function isUnsupportedEase(key) {
  return key in unsupportedEasingFunctions;
}
function replaceStringEasing(transition) {
  if (typeof transition.ease === "string" && isUnsupportedEase(transition.ease)) {
    transition.ease = unsupportedEasingFunctions[transition.ease];
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/NativeAnimationExtended.mjs
var sampleDelta = 10;
var NativeAnimationExtended = class extends NativeAnimation {
  constructor(options) {
    replaceStringEasing(options);
    replaceTransitionType(options);
    super(options);
    if (options.startTime !== void 0 && options.autoplay !== false) {
      this.startTime = options.startTime;
    }
    this.options = options;
  }
  /**
   * The animation's time now, in ms. Wall-clock rather than WAAPI's
   * currentTime while running, as under CPU load currentTime may not
   * reflect the actual elapsed time, causing incorrect sampling and
   * visual jumps.
   */
  elapsed() {
    return this.state === "running" ? (time.now() - this.startTime) * this.speed : this.time * 1e3;
  }
  /**
   * The value at a time, from a renderless JS animation.
   */
  sample(sampleTime) {
    if (!this.sampler) {
      const { motionValue: motionValue2, onUpdate, onComplete, onPlay, onStop, element, ...options } = this.options;
      this.sampler = new JSAnimation({ ...options, autoplay: false });
      this.sampler.stop();
    }
    return this.sampler.sample(Math.max(0, sampleTime)).value;
  }
  /**
   * The value now, as WAAPI doesn't set the motion value while it runs.
   */
  liveValue() {
    const { state } = this;
    if (state === "running" || state === "paused") {
      return this.sample(this.elapsed());
    }
  }
  /**
   * WAAPI doesn't natively have any interruption capabilities.
   *
   * Rather than read committed styles back out of the DOM, we can
   * sample a renderless JS animation twice to calculate its current
   * value, "previous" value, and therefore allow Motion to calculate
   * velocity for any subsequent animation.
   */
  updateMotionValue(value) {
    const { motionValue: motionValue2, element, name } = this.options;
    if (!motionValue2)
      return;
    if (value !== void 0) {
      motionValue2.set(value);
      return;
    }
    const { speed } = this;
    const sampleTime = this.elapsed();
    const delta = this.state === "running" && speed ? clamp(0, sampleDelta, sampleTime) : 0;
    const current = this.sample(sampleTime);
    if (element && name)
      setStyle(element, name, current);
    motionValue2.setWithVelocity(this.sample(sampleTime - delta * Math.sign(speed)), current, delta / Math.abs(speed || 1));
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/is-animatable.mjs
var isAnimatable = (value, name) => {
  if (name === "zIndex")
    return false;
  if (typeof value === "number" || Array.isArray(value))
    return true;
  if (typeof value === "string" && // It's animatable if we have a string
  (complex.test(value) || value === "0") && // And it contains numbers and/or colors
  !value.startsWith("url(")) {
    return true;
  }
  return false;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/can-animate.mjs
function hasKeyframesChanged(keyframes2) {
  const current = keyframes2[0];
  if (keyframes2.length === 1)
    return true;
  for (let i = 0; i < keyframes2.length; i++) {
    if (keyframes2[i] !== current)
      return true;
  }
}
function canAnimate(keyframes2, name, type, velocity) {
  const originKeyframe = keyframes2[0];
  if (originKeyframe === null) {
    return false;
  }
  if (name === "display" || name === "visibility")
    return true;
  const targetKeyframe = keyframes2[keyframes2.length - 1];
  const isOriginAnimatable = isAnimatable(originKeyframe, name);
  const isTargetAnimatable = isAnimatable(targetKeyframe, name);
  if (!isOriginAnimatable || !isTargetAnimatable) {
    isOriginAnimatable !== isTargetAnimatable && warning(false, `You are trying to animate ${name} from "${originKeyframe}" to "${targetKeyframe}". "${isOriginAnimatable ? targetKeyframe : originKeyframe}" is not an animatable value.`, "value-not-animatable");
    return false;
  }
  return hasKeyframesChanged(keyframes2) || (type === "spring" || isGenerator(type)) && velocity;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/make-animation-instant.mjs
function makeAnimationInstant(options) {
  options.duration = 0;
  options.type = "keyframes";
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/utils/accelerated-values.mjs
var acceleratedValues = /* @__PURE__ */ new Set([
  "opacity",
  "clipPath",
  "filter",
  "transform",
  "backgroundColor"
]);

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/utils/is-browser-color.mjs
var browserColorFunctions = /^(?:oklch|oklab|lab|lch|color|color-mix|light-dark)\(/;
function hasBrowserOnlyColors(keyframes2) {
  for (let i = 0; i < keyframes2.length; i++) {
    if (typeof keyframes2[i] === "string" && browserColorFunctions.test(keyframes2[i])) {
      return true;
    }
  }
  return false;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/supports/waapi.mjs
var colorProperties = /* @__PURE__ */ new Set([
  "color",
  "backgroundColor",
  "outlineColor",
  "fill",
  "stroke",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor"
]);
var supportsWaapi = /* @__PURE__ */ memo(() => Object.hasOwnProperty.call(Element.prototype, "animate"));
function supportsBrowserAnimation(options) {
  const { motionValue: motionValue2, name, repeatDelay, repeatType, damping, type, keyframes: keyframes2 } = options;
  if (!name || !(acceleratedValues.has(name) || colorProperties.has(name))) {
    return false;
  }
  const subject = motionValue2?.owner?.current;
  if (!(subject instanceof HTMLElement) && !(subject instanceof SVGElement)) {
    return false;
  }
  const { onUpdate, transformTemplate } = motionValue2.owner.getProps();
  return supportsWaapi() && /**
   * Force WAAPI for color properties with browser-only color formats
   * (oklch, oklab, lab, lch, etc.) that the JS animation path can't parse.
   */
  (acceleratedValues.has(name) || colorProperties.has(name) && hasBrowserOnlyColors(keyframes2)) && (name !== "transform" || !transformTemplate) && /**
   * If we're outputting values to onUpdate then we can't use WAAPI as there's
   * no way to read the value from WAAPI every frame.
   */
  !onUpdate && !repeatDelay && repeatType !== "mirror" && damping !== 0 && type !== "inertia";
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/utils/get-as-type.mjs
var getValueAsType = (value, type) => {
  return type && typeof value === "number" ? type.transform(value) : value;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/html/utils/build-transform.mjs
var translateAlias = {
  x: "translateX",
  y: "translateY",
  z: "translateZ",
  transformPerspective: "perspective"
};
var numTransforms = transformPropOrder.length;
function buildTransform(latestValues, transform, transformTemplate) {
  let transformString = "";
  let transformIsDefault = true;
  for (let i = 0; i < numTransforms; i++) {
    const key = transformPropOrder[i];
    const value = latestValues[key];
    if (value === void 0)
      continue;
    let valueIsDefault = true;
    if (typeof value === "number") {
      valueIsDefault = value === (key.startsWith("scale") ? 1 : 0);
    } else {
      const parsed = parseFloat(value);
      valueIsDefault = key.startsWith("scale") ? parsed === 1 : parsed === 0;
    }
    if (!valueIsDefault || transformTemplate) {
      const valueAsType = getValueAsType(value, numberValueTypes[key]);
      if (!valueIsDefault) {
        transformIsDefault = false;
        const transformName = translateAlias[key] || key;
        transformString += `${transformName}(${valueAsType}) `;
      }
      if (transformTemplate) {
        transform[key] = valueAsType;
      }
    }
  }
  const pathRotation = latestValues.pathRotation;
  if (pathRotation) {
    transformIsDefault = false;
    transformString += `rotate(${getValueAsType(pathRotation, numberValueTypes.pathRotation)}) `;
  }
  transformString = transformString.trim();
  if (transformTemplate) {
    transformString = transformTemplate(transform, transformIsDefault ? "" : transformString);
  } else if (transformIsDefault) {
    transformString = "none";
  }
  return transformString;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/transforms/groups.mjs
var transformGroups = /* @__PURE__ */ new WeakMap();

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/waapi/transforms/TransformAnimation.mjs
var maxSamples = 200;
var easingTolerance = 1e-3;
var sampleTolerance = 0.1;
var scaleTolerance = 1e-3;
var churnWindow = 100;
var isNativeEasing = (ease2) => /^(linear|ease(In|Out|InOut))$/.test(ease2);
var byTime = (a, b) => a - b;
var spread = (from, to, n) => {
  const result = [];
  for (let i = 0; i <= n; i++)
    result.push(mixNumber(from, to, i / n));
  return result;
};
var getOwner = (options) => options.motionValue.owner;
var getGroup = (element) => transformGroups.get(element);
var read = (owner, key) => owner.latestValues ? owner.latestValues[key] : owner.getValue(key)?.get();
var canGroupTransform = ({ name, motionValue: motionValue2 }) => name && transformPropOrder.includes(name) && motionValue2?.owner?.current instanceof HTMLElement && supportsWaapi() && supportsLinearEasing();
function canAccelerateTransform(options) {
  const owner = getOwner(options);
  const { onUpdate, transformTemplate } = owner.getProps();
  return (
    /**
     * A handoff from an optimised appear animation is already running
     * on its own WAAPI animation. onUpdate needs every value, every
     * frame.
     */
    !options.isHandoff && !onUpdate && !options.hasOnUpdate && /**
     * transformTemplate could output anything.
     */
    !transformTemplate && options.type !== "inertia" && /**
     * A literal transform, or pathRotation, replaces or adds to the
     * transform we'd build. styleEffect builds its own as "none".
     */
    (read(owner, "transform") || "none") === "none" && !read(owner, "pathRotation") && /**
     * Layout animations write transform every frame.
     */
    !owner.projection?.isProjecting()
  );
}
var TransformAnimation = class extends JSAnimation {
  constructor(options) {
    const element = getOwner(options).current;
    const { driver = frameloopDriver } = options;
    let animation;
    const canAccelerate = canAccelerateTransform(options);
    options.driver = (update) => {
      const js = driver(update);
      return {
        js,
        now: js.now,
        start: (keepAlive = true) => {
          const group = getGroup(element);
          const isJS = !group || group.isJS;
          isJS ? js.start(keepAlive) : group.schedule(false, !keepAlive);
        },
        stop: () => {
          js.stop();
          const group = getGroup(element);
          group && !group.isFinishing && group.release(animation);
        }
      };
    };
    super(options);
    animation = this;
    this.canAccelerate = canAccelerate;
    const { stop } = this;
    this.stop = () => {
      this.isAccelerated() && this.sync();
      stop();
    };
  }
  get group() {
    return getGroup(getOwner(this.options).current);
  }
  get js() {
    return this.driver?.js;
  }
  get name() {
    return this.options.name;
  }
  /**
   * When this stops moving, or, if it repeats forever, when it starts
   * repeating, and how long each repeat takes. Held (paused, or at
   * speed 0) animations never stop moving.
   */
  timing() {
    const { startTime, speed, totalDuration } = this;
    const { delay = 0, repeatType } = this.options;
    return this.holdTime !== null ? [Infinity, 0] : totalDuration === Infinity ? [
      startTime + delay / speed,
      this.resolvedDuration * (repeatType === "loop" ? 1 : 2) / speed || 1
    ] : [startTime + (delay + totalDuration) / speed, 0];
  }
  /**
   * Whether this is running, or paused, on the compositor.
   */
  isAccelerated() {
    const { group, state } = this;
    return group?.tracks.has(this) && !group.isJS && this.canAccelerate && (state === "running" || state === "paused");
  }
  /**
   * The value now, while this runs on the compositor and so doesn't
   * set its motion value every frame.
   */
  liveValue() {
    return this.isAccelerated() ? this.sampleAt(time.now()) : void 0;
  }
  /**
   * If this is a two-keyframe tween whose easing WAAPI runs exactly,
   * when it starts and stops moving, and that easing.
   */
  tween() {
    const { keyframes: keyframes$1, type, ease: ease2, times, repeat, delay = 0 } = this.options;
    const easing = isBezierDefinition(ease2) ? cubicBezierAsString(ease2) : isNativeEasing(ease2) && supportedWaapiEasing[ease2];
    if (easing && !repeat && !times && keyframes$1.length === 2 && type === keyframes && this.holdTime === null) {
      const start = this.startTime + delay / this.speed;
      return [start, start + this.resolvedDuration / this.speed, easing];
    }
  }
  /**
   * The timestamps between two timestamps where this reaches a
   * keyframe or starts a repeat, where it can turn or jump.
   */
  boundaries(from, to) {
    const { startTime, speed, resolvedDuration, options } = this;
    const { delay = 0, repeat = 0, repeatDelay = 0, repeatType, times, keyframes: keyframes$1, type } = options;
    const offsets = (type || keyframes) === keyframes ? times || defaultOffset(keyframes$1) : [0, 1];
    const start = startTime + delay / speed;
    const result = [];
    if (this.holdTime !== null || !(resolvedDuration > 0))
      return result;
    for (let i = Math.max(0, Math.floor((from - start) * speed / resolvedDuration)); i <= repeat; i++) {
      const iterationStart = start + i * resolvedDuration / speed;
      if (iterationStart > to)
        break;
      for (const offset of offsets) {
        const t = iterationStart + (i % 2 && repeatType && repeatType !== "loop" ? 1 - offset : offset) * (resolvedDuration - repeatDelay) / speed;
        t > from && t < to && result.push(t);
      }
    }
    return result;
  }
  /**
   * The value at a timestamp, as a number.
   */
  numberAt(timestamp) {
    return parseFloat(this.sampleAt(timestamp, true));
  }
  /**
   * Write the current value, and velocity, to the motion value.
   */
  sync() {
    const now2 = time.now();
    this.options.motionValue.setWithVelocity(this.sampleAt(now2 - sampleDelta, true), this.sampleAt(now2, true), sampleDelta);
  }
  play() {
    if (this.isStopped)
      return;
    (this.group || createGroup(getOwner(this.options))).tracks.add(this);
    super.play();
  }
  pause() {
    super.pause();
    if (this.isAccelerated()) {
      this.sync();
      this.group.schedule(false);
    }
  }
  /**
   * JSAnimation finishes on its next tick, which only happens on the
   * main thread, so finish now.
   */
  complete() {
    super.complete();
    const { group } = this;
    group && !group.isJS && this.canAccelerate && this.tick(time.now());
  }
  /**
   * Without a tick to rebase it, a held time still includes the delay,
   * so take it off here, as a JS animation does on its next tick.
   */
  get time() {
    if (this.isAccelerated()) {
      return millisecondsToSeconds(clamp(0, this.totalDuration, this.at(time.now()) - (this.options.delay || 0)));
    }
    return super.time;
  }
  /**
   * A JS animation sets its motion value from a seek on its next tick.
   * This doesn't tick, so set it now, rather than leave it to be set
   * when this next stops.
   */
  set time(newTime) {
    super.time = newTime;
    this.isAccelerated() && this.sync();
  }
  /**
   * Scroll timelines set time every frame, so run these on the main
   * thread.
   */
  attachTimeline(timeline) {
    this.canAccelerate = false;
    this.group?.demote(true);
    return super.attachTimeline(timeline);
  }
};
function createGroup(owner) {
  const element = owner.current;
  const tracks = /* @__PURE__ */ new Set();
  const byKey = /* @__PURE__ */ new Map();
  let statics = {};
  let keys = [];
  let built = /* @__PURE__ */ new Map();
  let segments = [];
  let needsBuild = false;
  let isScheduled2 = false;
  let isEnded = false;
  let hasChurned = false;
  let lastChurn = -Infinity;
  const has = (key) => {
    for (const track of tracks)
      if (track.name === key)
        return true;
  };
  const valuesAt = (timestamp, settled) => {
    const values = {};
    for (const key of timestamp === void 0 ? transformPropOrder : keys) {
      const track = byKey.get(key);
      const value = timestamp === void 0 ? read(owner, key) : track ? track.sampleAt(settled > timestamp && !track.timing()[1] ? settled : timestamp) : statics[key];
      if (value !== void 0)
        values[key] = value;
    }
    return values;
  };
  const compose = (timestamp, settled) => {
    let transform = "";
    const values = valuesAt(timestamp, settled);
    for (const key in values) {
      transform += (translateAlias[key] || key) + "(" + getValueAsType(values[key], numberValueTypes[key]) + ") ";
    }
    return transform || "none";
  };
  const commit = (values = valuesAt()) => {
    element.style.transform = buildTransform(values, {});
  };
  const stop = (shouldCommit = true) => {
    shouldCommit && commit();
    segments.forEach(({ animation }) => animation.cancel());
    segments = [];
  };
  const add = (animation, offset, end2 = Infinity) => {
    const segment = { animation, offset, end: end2 };
    animation.startTime = time.now() + offset;
    if (end2 < Infinity) {
      animation.onfinish = () => {
        segment.isDone = true;
        if (segments.some((s) => s.end === Infinity)) {
          animation.cancel();
          segments = segments.filter((s) => s !== segment);
        }
        group.schedule(false);
      };
    }
    animation.oncancel = () => segments.includes(segment) && group.demote();
    segments.push(segment);
  };
  const jumpAt = (value, a, b) => {
    const change = (x, y) => Math.abs(value(y) - value(x));
    const size = change(a, b);
    while (b - a > 0.01) {
      const mid = (a + b) / 2;
      change(a, mid) > change(mid, b) ? b = mid : a = mid;
    }
    return change(a, b) > size / 2 ? [a, b] : [];
  };
  const getEasing = (moving, from, to, bounds) => {
    const samples = Math.min(maxSamples, Math.max(2, Math.ceil((to - from) / sampleDelta)));
    if (bounds.length * 4 > samples)
      return;
    const at = spread(from, to, samples).concat(bounds).sort(byTime);
    const position = (t) => progress(from, to, t);
    let shared;
    let progressAt;
    for (const track of moving) {
      const values = at.map((t) => track.numberAt(t));
      const [first] = values;
      const changes = values.map((value) => value - first);
      const end2 = changes[changes.length - 1];
      const range = changes.some((change) => Math.abs(change) * easingTolerance > Math.abs(end2)) ? 0 : end2;
      const progress2 = changes.map((change) => range ? change / range : change);
      if (!range) {
        if (progress2.some((p) => !(Math.abs(p) <= easingTolerance))) {
          return;
        }
      } else if (!shared) {
        shared = progress2;
        progressAt = (t) => (track.numberAt(t) - first) / range;
      } else if (progress2.some((p, i) => !(Math.abs(p - shared[i]) <= easingTolerance))) {
        return;
      }
    }
    if (!shared || shared.every((p, i) => Math.abs(p - position(at[i])) <= easingTolerance)) {
      return "linear";
    }
    const points = [];
    const point = (t, p = progressAt(t)) => points.push(round(p) + " " + round(position(t) * 100) + "%");
    shared.forEach((p, i) => {
      i && Math.abs(p - shared[i - 1]) > 0.2 && jumpAt(progressAt, at[i - 1], at[i]).forEach((t) => point(t));
      point(at[i], p);
    });
    return "linear(" + points + ")";
  };
  const sample = (moving, from, to, bounds) => {
    const times = [from];
    const isStraight = (a, b) => moving.every((track) => !(Math.abs(track.numberAt((a + b) / 2) - (track.numberAt(a) + track.numberAt(b)) / 2) > (track.name.startsWith("scale") ? scaleTolerance : sampleTolerance)));
    const split = (a, b, depth) => {
      if (b - a < 1 || isStraight(a, b)) {
        times.push(b);
      } else if (depth < 4) {
        split(a, (a + b) / 2, depth + 1);
        split((a + b) / 2, b, depth + 1);
      } else {
        for (const track of moving) {
          times.push(...jumpAt((t) => track.numberAt(t), a, b));
        }
        times.push(b);
      }
    };
    const ends = spread(from, to, Math.ceil((to - from) / 100));
    for (const t of bounds)
      ends.push(t, Math.min(t + 0.01, to));
    let start = from;
    for (const end2 of ends.sort(byTime)) {
      end2 > start && split(start, end2, 0);
      start = end2;
    }
    return times.sort(byTime);
  };
  const getTween = (moving) => {
    let shared;
    for (const track of moving) {
      const tween = track.tween();
      if (!tween || shared?.some((v, i) => i < 2 ? Math.abs(tween[i] - v) > 1 : tween[i] !== v)) {
        return;
      }
      shared = tween;
    }
    return shared;
  };
  const run = (moving, from, to, options = { fill: "both" }, settled, nativeEasing) => {
    const bounds = moving.flatMap((track) => track.boundaries(from, to));
    const easing = nativeEasing || getEasing(moving, from, to, bounds);
    const times = easing ? [from, to] : sample(moving, from, to, bounds);
    const transform = times.map((t) => compose(t, settled));
    let keyframes2 = { transform };
    if (!easing) {
      keyframes2.offset = times.map((t) => progress(from, to, t));
    }
    if (transform.every((t) => t === transform[0])) {
      commit(valuesAt(from, settled));
      keyframes2 = null;
    }
    return element.animate(keyframes2, {
      ...options,
      duration: to - from,
      easing: easing || "linear"
    });
  };
  const animate2 = (now2) => {
    let end2 = now2;
    let cycle = 0;
    let cycleStart = 0;
    const moving = [];
    const looping = [];
    const ends = /* @__PURE__ */ new Set();
    byKey.clear();
    built = /* @__PURE__ */ new Map();
    for (const track of tracks) {
      byKey.set(track.name, track);
      const [trackEnd, trackCycle] = track.timing();
      const isHeld = trackEnd === Infinity;
      built.set(track, [track.at(now2), track.speed, isHeld]);
      if (isHeld) {
        track.sync();
        continue;
      }
      if (track.speed < 0)
        return;
      if (trackCycle) {
        if (cycle) {
          const phase = (trackEnd - cycleStart) / trackCycle;
          if (Math.abs(trackCycle - cycle) > 1 || Math.abs(phase - Math.round(phase)) * cycle > 1) {
            return;
          }
        } else {
          cycle = trackCycle;
          cycleStart = trackEnd;
        }
        looping.push(track);
      } else {
        ends.add(trackEnd);
      }
      moving.push(track);
      end2 = Math.max(end2, trackEnd);
    }
    statics = {};
    keys = transformPropOrder.filter((key) => {
      if (byKey.has(key))
        return true;
      const value = statics[key] = read(owner, key);
      return value !== void 0 && parseFloat(value) !== (key.startsWith("scale") ? 1 : 0);
    });
    stop(false);
    const tween = !cycle && getTween(moving);
    try {
      if (tween && tween[1] > now2) {
        const [from, to, easing] = tween;
        add(run(moving, from, to, void 0, void 0, easing), from - now2, to - from);
      } else if (end2 > now2) {
        add(run(moving, now2, end2), 0, end2 - now2);
        ends.forEach((trackEnd) => trackEnd < end2 - 1 && add(element.animate(null, {
          duration: trackEnd - now2
        }), 0, trackEnd - now2));
      }
      if (cycle) {
        const from = cycleStart + Math.floor((end2 - cycleStart) / cycle) * cycle;
        add(run(looping, from, from + cycle, {
          iterations: Infinity,
          iterationStart: (end2 - from) / cycle,
          /**
           * It must not fill backwards over the finite part
           * that runs before it.
           */
          fill: "forwards"
        }, end2), end2 - now2);
      }
    } catch {
      return;
    }
    segments.length || stop();
    return true;
  };
  const retime = (now2) => {
    let elapsed;
    let rate = 0;
    for (const track of tracks) {
      const state = built.get(track);
      if (!state)
        return false;
      const [builtTime, builtSpeed, wasHeld] = state;
      const trackTime = track.at(now2);
      const isHeld = track.timing()[0] === Infinity;
      if (wasHeld) {
        if (isHeld && trackTime === builtTime)
          continue;
        return false;
      }
      const trackElapsed = (trackTime - builtTime) / builtSpeed;
      const trackRate = isHeld ? 0 : track.speed / builtSpeed;
      if (elapsed === void 0) {
        elapsed = trackElapsed;
        rate = trackRate;
      } else if (Math.abs(trackElapsed - elapsed) > 1 || trackRate !== rate) {
        return false;
      }
    }
    if (elapsed === void 0)
      return true;
    if (!segments.length)
      return false;
    for (const { offset, end: end2, isDone } of segments) {
      const local = elapsed - offset;
      if (end2 < Infinity && (isDone ? local < end2 - 1 : local < 0 || local >= end2)) {
        return false;
      }
    }
    for (const { animation, offset, isDone } of segments) {
      if (isDone)
        continue;
      const local = elapsed - offset;
      if (rate) {
        animation.playbackRate = rate;
        animation.startTime = now2 - local / rate;
      } else {
        animation.pause();
        animation.currentTime = local;
      }
    }
    return true;
  };
  const end = () => {
    if (tracks.size)
      return false;
    isEnded = true;
    getGroup(element) === group && transformGroups.delete(element);
    group.isJS || stop();
    return true;
  };
  const build = () => {
    const now2 = time.now();
    if (!group.isJS) {
      group.isFinishing = true;
      tracks.forEach((track) => {
        const [trackEnd, trackCycle] = track.timing();
        if (track.state === "running" && track.speed > 0 && !trackCycle && trackEnd <= now2 + 1) {
          track.complete();
          statics[track.name] = read(owner, track.name);
          built.has(track) || (needsBuild = true);
        }
      });
      group.isFinishing = false;
    }
    isScheduled2 = false;
    if (isEnded)
      return;
    tracks.forEach(({ state }, track) => {
      if (state === "idle" || state === "finished")
        tracks.delete(track);
    });
    if (end())
      return;
    for (const track of tracks) {
      if (!track.canAccelerate)
        return group.demote(true);
    }
    if (group.isJS) {
      group.isJS = false;
      needsBuild = true;
      tracks.forEach((track) => track.js?.stop());
    }
    const shouldBuild = needsBuild;
    const churned = hasChurned;
    needsBuild = hasChurned = false;
    if (shouldBuild || !retime(now2)) {
      if (churned) {
        if (now2 - lastChurn < churnWindow)
          return group.demote();
        lastChurn = now2;
      }
      if (!animate2(now2))
        return group.demote();
    }
  };
  const group = {
    tracks,
    isJS: false,
    isFinishing: false,
    schedule(build_, isChurn) {
      if (isEnded)
        return;
      needsBuild || (needsBuild = build_);
      hasChurned || (hasChurned = !!isChurn);
      if (!isScheduled2) {
        isScheduled2 = true;
        frameData.isProcessing ? frame.render(build, false, true) : queueMicrotask(build);
      }
    },
    /**
     * End the group now, rather than when it next builds, so the
     * element's transform is the caller's again as soon as its last
     * animation is stopped.
     */
    release(track) {
      const { state } = track;
      if (state === "idle" || state === "finished")
        tracks.delete(track);
      end() || group.schedule(true);
    },
    /**
     * An outside write. Rebuild once, but if it keeps happening, move
     * to the main thread.
     */
    check() {
      if (group.isJS)
        return;
      for (const key in statics) {
        if (read(owner, key) !== statics[key] && !has(key)) {
          return group.schedule(true, true);
        }
      }
    },
    demote(canReturn) {
      if (group.isJS || isEnded)
        return;
      tracks.forEach((track) => {
        track.isAccelerated() && track.sync();
        canReturn || (track.canAccelerate = false);
      });
      group.isJS = true;
      built = /* @__PURE__ */ new Map();
      stop();
      tracks.forEach((track) => track.state === "running" && track.js?.start());
    }
  };
  transformGroups.set(element, group);
  return group;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/AsyncMotionValueAnimation.mjs
var AsyncMotionValueAnimation = class extends WithPromise {
  constructor(options) {
    super();
    this.stop = () => {
      if (this._animation) {
        this._animation.stop();
        this.stopTimeline?.();
      }
      this.keyframeResolver?.cancel();
    };
    this.createdAt = time.now();
    const { keyframes: keyframes2, name, motionValue: motionValue2, element } = options;
    const optionsWithDefaults = options;
    optionsWithDefaults.autoplay ?? (optionsWithDefaults.autoplay = true);
    optionsWithDefaults.delay ?? (optionsWithDefaults.delay = 0);
    optionsWithDefaults.type ?? (optionsWithDefaults.type = "keyframes");
    optionsWithDefaults.repeat ?? (optionsWithDefaults.repeat = 0);
    optionsWithDefaults.repeatDelay ?? (optionsWithDefaults.repeatDelay = 0);
    optionsWithDefaults.repeatType ?? (optionsWithDefaults.repeatType = "loop");
    const KeyframeResolver$1 = element?.KeyframeResolver || KeyframeResolver;
    this.keyframeResolver = new KeyframeResolver$1(keyframes2, (resolvedKeyframes, finalKeyframe, forced) => this.onKeyframesResolved(resolvedKeyframes, finalKeyframe, optionsWithDefaults, !forced), name, motionValue2, element);
    this.keyframeResolver?.scheduleResolve();
  }
  onKeyframesResolved(keyframes2, finalKeyframe, options, sync) {
    this.keyframeResolver = void 0;
    const { name, type, velocity, delay, isHandoff, onUpdate } = options;
    this.resolvedAt = time.now();
    let canAnimateValue = true;
    if (!canAnimate(keyframes2, name, type, velocity)) {
      canAnimateValue = false;
      if (MotionGlobalConfig.instantAnimations || !delay) {
        onUpdate?.(getFinalKeyframe(keyframes2, options, finalKeyframe));
      }
      keyframes2[0] = keyframes2[keyframes2.length - 1];
      makeAnimationInstant(options);
      options.repeat = 0;
    }
    const { onComplete } = options;
    options.finalKeyframe = finalKeyframe;
    options.keyframes = keyframes2;
    options.onComplete = () => {
      onComplete?.();
      this.notifyFinished();
    };
    const useWaapi = canAnimateValue && !isHandoff && supportsBrowserAnimation(options);
    const isGroupedTransform = !useWaapi && canGroupTransform(options);
    if (sync && (useWaapi || isGroupedTransform || this.resolvedAt !== this.createdAt)) {
      options.startTime ?? (options.startTime = resolveStartTime(this.createdAt, this.resolvedAt));
    }
    let animation;
    if (useWaapi) {
      options.element = options.motionValue?.owner?.current;
      try {
        animation = new NativeAnimationExtended(options);
      } catch {
        animation = new JSAnimation(options);
      }
    } else if (isGroupedTransform) {
      animation = new TransformAnimation(options);
    } else {
      animation = new JSAnimation(options);
    }
    if (this.pendingTimeline) {
      this.stopTimeline = animation.attachTimeline(this.pendingTimeline);
      this.pendingTimeline = void 0;
    }
    this._animation = animation;
  }
  get finished() {
    return this._animation ? this._animation.finished : super.finished;
  }
  then(onResolve, _onReject) {
    return this.finished.finally(onResolve).then(() => {
    });
  }
  /**
   * The value now, if the animation runs on the compositor.
   */
  liveValue() {
    return this._animation?.liveValue?.();
  }
  get animation() {
    if (!this._animation) {
      this.keyframeResolver?.resume();
      flushKeyframeResolvers();
    }
    return this._animation;
  }
  get duration() {
    return this.animation.duration;
  }
  get iterationDuration() {
    return this.animation.iterationDuration;
  }
  get time() {
    return this.animation.time;
  }
  set time(newTime) {
    this.animation.time = newTime;
  }
  get speed() {
    return this.animation.speed;
  }
  get state() {
    return this.animation.state;
  }
  set speed(newSpeed) {
    this.animation.speed = newSpeed;
  }
  get startTime() {
    return this.animation.startTime;
  }
  attachTimeline(timeline) {
    if (this._animation) {
      this.stopTimeline = this.animation.attachTimeline(timeline);
    } else {
      this.pendingTimeline = timeline;
    }
    return () => this.stop();
  }
  play() {
    this.animation.play();
  }
  pause() {
    this.animation.pause();
  }
  complete() {
    this.animation.complete();
  }
  cancel() {
    if (this._animation) {
      this.animation.cancel();
    }
    this.keyframeResolver?.cancel();
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/GroupAnimation.mjs
var GroupAnimation = class {
  constructor(animations) {
    this.stop = () => this.runAll("stop");
    this.animations = animations.filter(Boolean);
  }
  get finished() {
    return Promise.all(this.animations.map((animation) => animation.finished));
  }
  /**
   * TODO: Filter out cancelled or stopped animations before returning
   */
  getAll(propName) {
    return this.animations[0][propName];
  }
  setAll(propName, newValue) {
    for (let i = 0; i < this.animations.length; i++) {
      this.animations[i][propName] = newValue;
    }
  }
  attachTimeline(timeline) {
    const subscriptions = this.animations.map((animation) => animation.attachTimeline(timeline));
    return () => {
      subscriptions.forEach((cancel, i) => {
        cancel && cancel();
        this.animations[i].stop();
      });
    };
  }
  get time() {
    return this.getAll("time");
  }
  set time(time2) {
    this.setAll("time", time2);
  }
  get speed() {
    return this.getAll("speed");
  }
  set speed(speed) {
    this.setAll("speed", speed);
  }
  get state() {
    return this.getAll("state");
  }
  get startTime() {
    return this.getAll("startTime");
  }
  get duration() {
    return getMax(this.animations, "duration");
  }
  get iterationDuration() {
    return getMax(this.animations, "iterationDuration");
  }
  runAll(methodName) {
    this.animations.forEach((controls) => controls[methodName]());
  }
  play() {
    this.runAll("play");
  }
  pause() {
    this.runAll("pause");
  }
  cancel() {
    this.runAll("cancel");
  }
  complete() {
    this.runAll("complete");
  }
};
function getMax(animations, propName) {
  let max = 0;
  for (let i = 0; i < animations.length; i++) {
    const value = animations[i][propName];
    if (value !== null && value > max) {
      max = value;
    }
  }
  return max;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/GroupAnimationWithThen.mjs
var GroupAnimationWithThen = class extends GroupAnimation {
  then(onResolve, _onReject) {
    return this.finished.finally(onResolve).then(() => {
    });
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/index.mjs
var MAX_VELOCITY_DELTA = 30;
var isFloat = (value) => {
  return !isNaN(parseFloat(value));
};
var collectMotionValues = {
  current: void 0
};
var MotionValue = class {
  /**
   * @param init - The initiating value
   * @param config - Optional configuration options
   *
   * -  `transformer`: A function to transform incoming values with.
   */
  constructor(init, options = {}) {
    this.canTrackVelocity = null;
    this.events = {};
    this.updateAndNotify = (v) => {
      const currentTime = time.now();
      if (this.updatedAt !== currentTime) {
        this.setPrevFrameValue();
      }
      this.prev = this.current;
      this.setCurrent(v);
      if (this.current !== this.prev) {
        this.notifyChange();
        if (this.dependents) {
          for (const dependent of this.dependents) {
            dependent.dirty();
          }
        }
      }
    };
    this.hasAnimated = false;
    this.setCurrent(init);
    this.owner = options.owner;
  }
  setCurrent(current) {
    this.current = current;
    this.updatedAt = time.now();
    if (this.canTrackVelocity === null && current !== void 0) {
      this.canTrackVelocity = isFloat(this.current);
    }
  }
  setPrevFrameValue(prevFrameValue = this.current) {
    this.prevFrameValue = prevFrameValue;
    this.prevUpdatedAt = this.updatedAt;
  }
  /**
   * Adds a function that will be notified when the `MotionValue` is updated.
   *
   * It returns a function that, when called, will cancel the subscription.
   *
   * When calling `onChange` inside a React component, it should be wrapped with the
   * `useEffect` hook. As it returns an unsubscribe function, this should be returned
   * from the `useEffect` function to ensure you don't add duplicate subscribers..
   *
   * ```jsx
   * export const MyComponent = () => {
   *   const x = useMotionValue(0)
   *   const y = useMotionValue(0)
   *   const opacity = useMotionValue(1)
   *
   *   useEffect(() => {
   *     function updateOpacity() {
   *       const maxXY = Math.max(x.get(), y.get())
   *       const newOpacity = transform(maxXY, [0, 100], [1, 0])
   *       opacity.set(newOpacity)
   *     }
   *
   *     const unsubscribeX = x.on("change", updateOpacity)
   *     const unsubscribeY = y.on("change", updateOpacity)
   *
   *     return () => {
   *       unsubscribeX()
   *       unsubscribeY()
   *     }
   *   }, [])
   *
   *   return <motion.div style={{ x }} />
   * }
   * ```
   *
   * @param subscriber - A function that receives the latest value.
   * @returns A function that, when called, will cancel this subscription.
   *
   * @deprecated
   */
  onChange(subscription) {
    if (true) {
      warnOnce(false, `value.onChange(callback) is deprecated. Switch to value.on("change", callback).`);
    }
    return this.on("change", subscription);
  }
  on(eventName, callback) {
    var _a;
    if (eventName === "change")
      return this.onChangeSubscribe(callback);
    return ((_a = this.events)[eventName] || (_a[eventName] = new SubscriptionManager())).add(callback);
  }
  onChangeSubscribe(callback) {
    const { events } = this;
    if (!events.change && !this.changeSubscriber) {
      this.changeSubscriber = callback;
    } else {
      if (!events.change) {
        events.change = new SubscriptionManager();
        events.change.add(this.changeSubscriber);
        this.changeSubscriber = void 0;
      }
      events.change.add(callback);
    }
    return () => {
      if (this.changeSubscriber === callback) {
        this.changeSubscriber = void 0;
      } else {
        events.change?.remove(callback);
      }
      this.stopIfUnobserved();
    };
  }
  /**
   * If we have no more change listeners by the start
   * of the next frame, stop active animations.
   */
  stopIfUnobserved() {
    frame.read(() => {
      if (!this.changeSubscriber && !this.events.change?.getSize()) {
        this.stop();
      }
    });
  }
  clearListeners() {
    this.changeSubscriber = void 0;
    for (const eventManagers in this.events) {
      this.events[eventManagers].clear();
    }
  }
  /**
   * Attaches a passive effect to the `MotionValue`.
   */
  attach(passiveEffect, stopPassiveEffect) {
    this.passiveEffect = passiveEffect;
    this.stopPassiveEffect = stopPassiveEffect;
  }
  /**
   * Sets the state of the `MotionValue`.
   *
   * @remarks
   *
   * ```jsx
   * const x = useMotionValue(0)
   * x.set(10)
   * ```
   *
   * @param latest - Latest value to set.
   * @param render - Whether to notify render subscribers. Defaults to `true`
   *
   * @public
   */
  set(v) {
    if (!this.passiveEffect) {
      this.updateAndNotify(v);
    } else {
      this.passiveEffect(v, this.updateAndNotify);
    }
  }
  setWithVelocity(prev, current, delta) {
    this.set(current);
    this.prev = void 0;
    this.prevFrameValue = prev;
    this.prevUpdatedAt = this.updatedAt - delta;
  }
  /**
   * Set the state of the `MotionValue`, stopping any active animations,
   * effects, and resets velocity to `0`.
   */
  jump(v, endAnimation = true) {
    this.updateAndNotify(v);
    this.prev = v;
    this.prevUpdatedAt = this.prevFrameValue = void 0;
    endAnimation && this.stop();
    if (this.stopPassiveEffect)
      this.stopPassiveEffect();
  }
  dirty() {
    this.notifyChange();
  }
  notifyChange() {
    const { current, changeSubscriber } = this;
    if (changeSubscriber) {
      changeSubscriber(current);
    } else {
      this.events.change?.notify(current);
    }
  }
  addDependent(dependent) {
    if (!this.dependents) {
      this.dependents = /* @__PURE__ */ new Set();
    }
    this.dependents.add(dependent);
  }
  removeDependent(dependent) {
    if (this.dependents) {
      this.dependents.delete(dependent);
    }
  }
  /**
   * Returns the latest state of `MotionValue`
   *
   * @returns - The latest state of `MotionValue`
   *
   * @public
   */
  get() {
    if (collectMotionValues.current) {
      collectMotionValues.current.push(this);
    }
    const sampled = this.animation?.liveValue?.();
    return sampled === void 0 ? this.current : sampled;
  }
  /**
   * The value as last set. Unlike get(), this doesn't read an animation
   * running on the compositor, which renders the value itself.
   */
  getCurrent() {
    return this.current;
  }
  /**
   * @public
   */
  getPrevious() {
    return this.prev;
  }
  /**
   * Returns the latest velocity of `MotionValue`
   *
   * @returns - The latest velocity of `MotionValue`. Returns `0` if the state is non-numerical.
   *
   * @public
   */
  getVelocity() {
    const currentTime = time.now();
    if (!this.canTrackVelocity || this.prevFrameValue === void 0 || currentTime - this.updatedAt > MAX_VELOCITY_DELTA) {
      return 0;
    }
    const delta = Math.min(this.updatedAt - this.prevUpdatedAt, MAX_VELOCITY_DELTA);
    return velocityPerSecond(parseFloat(this.current) - parseFloat(this.prevFrameValue), delta);
  }
  /**
   * Registers a new animation to control this `MotionValue`. Only one
   * animation can drive a `MotionValue` at one time.
   *
   * ```jsx
   * value.start()
   * ```
   *
   * @param animation - A function that starts the provided animation
   */
  start(startAnimation) {
    this.stop();
    return new Promise((resolve) => {
      this.hasAnimated = true;
      let isComplete = false;
      let animation;
      animation = startAnimation(() => {
        isComplete = true;
        this.events.animationComplete?.notify();
        if (this.animation === animation)
          this.clearAnimation();
        resolve();
      });
      if (!isComplete)
        this.animation = animation;
      this.events.animationStart?.notify();
    });
  }
  /**
   * Stop the currently active animation.
   *
   * @public
   */
  stop() {
    if (this.animation) {
      this.animation.stop();
      if (this.events.animationCancel) {
        this.events.animationCancel.notify();
      }
    }
    this.clearAnimation();
  }
  /**
   * Returns `true` if this value is currently animating.
   *
   * @public
   */
  isAnimating() {
    return !!this.animation;
  }
  clearAnimation() {
    this.animation = void 0;
  }
  /**
   * Destroy and clean up subscribers to this `MotionValue`.
   *
   * The `MotionValue` hooks like `useMotionValue` and `useTransform` automatically
   * handle the lifecycle of the returned `MotionValue`, so this method is only necessary if you've manually
   * created a `MotionValue` via the `motionValue` function.
   *
   * @public
   */
  destroy() {
    this.dependents?.clear();
    this.events.destroy?.notify();
    this.clearListeners();
    this.stop();
    if (this.stopPassiveEffect) {
      this.stopPassiveEffect();
    }
  }
};
function motionValue(init, options) {
  return new MotionValue(init, options);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/resolve-transition.mjs
function resolveTransition(transition, parentTransition) {
  if (transition?.inherit && parentTransition) {
    const { inherit: _, ...rest } = transition;
    return { ...parentTransition, ...rest };
  }
  return transition;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/get-value-transition.mjs
function getValueTransition(transition, key) {
  const valueTransition = transition?.[key] ?? transition?.["default"] ?? transition;
  if (valueTransition !== transition) {
    return resolveTransition(valueTransition, transition);
  }
  return valueTransition;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/default-transitions.mjs
var underDampedSpring = {
  type: "spring",
  stiffness: 500,
  damping: 25,
  restSpeed: 10
};
var criticallyDampedSpring = (target) => ({
  type: "spring",
  stiffness: 550,
  damping: target === 0 ? 2 * Math.sqrt(550) : 30,
  restSpeed: 10
});
var keyframesTransition = {
  type: "keyframes",
  duration: 0.8
};
var ease = {
  type: "keyframes",
  ease: [0.25, 0.1, 0.35, 1],
  duration: 0.3
};
var getDefaultTransition = (valueKey, { keyframes: keyframes2 }) => {
  if (keyframes2.length > 2) {
    return keyframesTransition;
  } else if (transformProps.has(valueKey)) {
    return valueKey.startsWith("scale") ? criticallyDampedSpring(keyframes2[1]) : underDampedSpring;
  }
  return ease;
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/is-transition-defined.mjs
var orchestrationKeys = /* @__PURE__ */ new Set([
  "when",
  "delay",
  "delayChildren",
  "staggerChildren",
  "staggerDirection",
  "repeat",
  "repeatType",
  "repeatDelay",
  "from",
  "elapsed"
]);
function isTransitionDefined(transition) {
  for (const key in transition) {
    if (!orchestrationKeys.has(key))
      return true;
  }
  return false;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/interfaces/motion-value.mjs
var animateMotionValue = (name, value, target, transition = {}, element, isHandoff) => (onComplete) => {
  const valueTransition = getValueTransition(transition, name) || {};
  const delay = valueTransition.delay || transition.delay || 0;
  let { elapsed = 0 } = transition;
  elapsed = elapsed - secondsToMilliseconds(delay);
  const options = {
    keyframes: Array.isArray(target) ? target : [null, target],
    ease: "easeOut",
    velocity: value.getVelocity(),
    ...valueTransition,
    delay: -elapsed,
    onUpdate: (v) => {
      value.set(v);
      valueTransition.onUpdate && valueTransition.onUpdate(v);
    },
    onComplete: () => {
      onComplete();
      valueTransition.onComplete && valueTransition.onComplete();
    },
    name,
    motionValue: value,
    element: isHandoff ? void 0 : element,
    hasOnUpdate: !!valueTransition.onUpdate
  };
  if (!isTransitionDefined(valueTransition)) {
    Object.assign(options, getDefaultTransition(name, options));
  }
  options.duration && (options.duration = secondsToMilliseconds(options.duration));
  options.repeatDelay && (options.repeatDelay = secondsToMilliseconds(options.repeatDelay));
  if (options.from !== void 0) {
    options.keyframes[0] = options.from;
  }
  let shouldSkip = false;
  if (options.type === false || options.duration === 0 && !options.repeatDelay) {
    makeAnimationInstant(options);
    if (options.delay === 0) {
      shouldSkip = true;
    }
  }
  if (MotionGlobalConfig.instantAnimations || MotionGlobalConfig.skipAnimations || element?.shouldSkipAnimations || valueTransition.skipAnimations) {
    shouldSkip = true;
    makeAnimationInstant(options);
    options.delay = 0;
  }
  options.allowFlatten = !valueTransition.type && !valueTransition.ease;
  if (shouldSkip && !isHandoff && value.get() !== void 0) {
    const finalKeyframe = getFinalKeyframe(options.keyframes, valueTransition);
    if (finalKeyframe !== void 0) {
      frame.update(() => {
        options.onUpdate(finalKeyframe);
        options.onComplete();
      });
      return;
    }
  }
  return valueTransition.isSync ? new JSAnimation(options) : new AsyncMotionValueAnimation(options);
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/utils/css-variables-conversion.mjs
var splitCSSVariableRegex = (
  // eslint-disable-next-line redos-detector/no-unsafe-regex -- false positive, as it can match a lot of words
  /^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u
);
function parseCSSVariable(current) {
  const match = splitCSSVariableRegex.exec(current);
  if (!match)
    return [,];
  const [, token1, token2, fallback] = match;
  return [`--${token1 ?? token2}`, fallback];
}
var maxDepth = 4;
function getVariableValue(current, element, depth = 1) {
  invariant(depth <= maxDepth, `Max CSS variable fallback depth detected in property "${current}". This may indicate a circular fallback dependency.`, "max-css-var-depth");
  const [token, fallback] = parseCSSVariable(current);
  if (!token)
    return;
  const resolved = window.getComputedStyle(element).getPropertyValue(token);
  if (resolved) {
    const trimmed = resolved.trim();
    return isNumericalString(trimmed) ? parseFloat(trimmed) : trimmed;
  }
  return isCSSVariableToken(fallback) ? getVariableValue(fallback, element, depth + 1) : fallback;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/utils/keys-position.mjs
var positionalKeys = /* @__PURE__ */ new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  ...transformPropOrder
]);

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/utils/is-motion-value.mjs
var isMotionValue = (value) => Boolean(value && value.getVelocity);

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/dom/utils/camel-to-dash.mjs
function camelToDash(str) {
  return str.replace(/([A-Z])/g, (match) => `-${match.toLowerCase()}`);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/auto.mjs
var auto = {
  test: (v) => v === "auto",
  parse: (v) => v
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/test.mjs
var testValueType = (v) => (type) => type.test(v);

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/value/types/dimensions.mjs
var dimensionValueTypes = [number, px, percent, degrees, vw, vh, auto];
var findDimensionValueType = (v) => dimensionValueTypes.find(testValueType(v));

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/utils/is-none.mjs
function isNone(value) {
  if (typeof value === "number") {
    return value === 0;
  } else if (value !== null) {
    return value === "none" || value === "0" || isZeroValueString(value);
  } else {
    return true;
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/utils/make-none-animatable.mjs
var invalidTemplates = /* @__PURE__ */ new Set(["auto", "none", "0"]);
function makeNoneKeyframesAnimatable(unresolvedKeyframes, noneKeyframeIndexes, name) {
  let i = 0;
  let animatableTemplate = void 0;
  while (i < unresolvedKeyframes.length && !animatableTemplate) {
    const keyframe = unresolvedKeyframes[i];
    if (typeof keyframe === "string" && !invalidTemplates.has(keyframe) && hasComplexValues(keyframe)) {
      animatableTemplate = unresolvedKeyframes[i];
    }
    i++;
  }
  if (animatableTemplate && name) {
    for (const noneIndex of noneKeyframeIndexes) {
      if (unresolvedKeyframes[noneIndex] === animatableTemplate)
        continue;
      unresolvedKeyframes[noneIndex] = getAnimatableNone2(name, animatableTemplate);
    }
  }
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/keyframes/DOMKeyframesResolver.mjs
var DOMKeyframesResolver = class extends KeyframeResolver {
  constructor(unresolvedKeyframes, onComplete, name, motionValue2, element) {
    super(unresolvedKeyframes, onComplete, name, motionValue2, element, true);
  }
  /**
   * Keyframes that don't need reading from the DOM, or measuring,
   * resolve straight away rather than in the frame loop's batched read.
   */
  scheduleResolve() {
    if (this.canReadNow()) {
      this.readKeyframes();
      if (!this.needsMeasurement)
        return this.complete();
    }
    super.scheduleResolve();
  }
  canReadNow() {
    const { unresolvedKeyframes, element, motionValue: motionValue2 } = this;
    const origin = unresolvedKeyframes[0] ?? motionValue2?.get();
    if (!element?.current || origin === void 0)
      return false;
    for (let i = 0; i < unresolvedKeyframes.length; i++) {
      if (containsCSSVariable(i ? unresolvedKeyframes[i] : origin)) {
        return false;
      }
    }
    return true;
  }
  readKeyframes() {
    const { unresolvedKeyframes, element, name } = this;
    if (!element || !element.current)
      return;
    super.readKeyframes();
    for (let i = 0; i < unresolvedKeyframes.length; i++) {
      let keyframe = unresolvedKeyframes[i];
      if (typeof keyframe === "string") {
        keyframe = keyframe.trim();
        if (isCSSVariableToken(keyframe)) {
          const resolved = getVariableValue(keyframe, element.current);
          if (resolved !== void 0) {
            unresolvedKeyframes[i] = resolved;
          }
          if (i === unresolvedKeyframes.length - 1) {
            this.finalKeyframe = keyframe;
          }
        }
      }
    }
    this.resolveNoneKeyframes();
    if (!positionalKeys.has(name) || unresolvedKeyframes.length !== 2) {
      return;
    }
    const [origin, target] = unresolvedKeyframes;
    if (typeof origin === "number" && typeof target === "number")
      return;
    const originType = findDimensionValueType(origin);
    const targetType = findDimensionValueType(target);
    const originHasVar = containsCSSVariable(origin);
    const targetHasVar = containsCSSVariable(target);
    if (originHasVar !== targetHasVar && positionalValues[name]) {
      this.needsMeasurement = true;
      return;
    }
    if (originType === targetType)
      return;
    if (isNumOrPxType(originType) && isNumOrPxType(targetType)) {
      for (let i = 0; i < unresolvedKeyframes.length; i++) {
        const value = unresolvedKeyframes[i];
        if (typeof value === "string") {
          unresolvedKeyframes[i] = parseFloat(value);
        }
      }
    } else if (positionalValues[name]) {
      this.needsMeasurement = true;
    }
  }
  resolveNoneKeyframes() {
    const { unresolvedKeyframes, name } = this;
    const noneKeyframeIndexes = [];
    for (let i = 0; i < unresolvedKeyframes.length; i++) {
      if (unresolvedKeyframes[i] === null || isNone(unresolvedKeyframes[i])) {
        noneKeyframeIndexes.push(i);
      }
    }
    if (noneKeyframeIndexes.length) {
      makeNoneKeyframesAnimatable(unresolvedKeyframes, noneKeyframeIndexes, name);
    }
  }
  measure() {
    const { element, name } = this;
    return positionalValues[name](window.getComputedStyle(element.current), () => element.measureViewportBox());
  }
  measureInitialState() {
    const { element, unresolvedKeyframes, name } = this;
    if (!element || !element.current)
      return;
    if (name === "height") {
      this.suspendedScrollY = window.pageYOffset;
    }
    this.measuredOrigin = this.measure();
    unresolvedKeyframes[0] = this.measuredOrigin;
    const measureKeyframe = unresolvedKeyframes[unresolvedKeyframes.length - 1];
    if (measureKeyframe !== void 0) {
      this.motionValue?.jump(measureKeyframe, false);
    }
  }
  measureEndState() {
    const { element, unresolvedKeyframes } = this;
    if (!element || !element.current)
      return;
    this.motionValue?.jump(this.measuredOrigin, false);
    const finalKeyframeIndex = unresolvedKeyframes.length - 1;
    const finalKeyframe = unresolvedKeyframes[finalKeyframeIndex];
    unresolvedKeyframes[finalKeyframeIndex] = this.measure();
    if (finalKeyframe !== null && this.finalKeyframe === void 0) {
      this.finalKeyframe = finalKeyframe;
    }
    if (this.removedTransforms?.length) {
      this.removedTransforms.forEach(([unsetTransformName, unsetTransformValue]) => {
        element.getValue(unsetTransformName).set(unsetTransformValue);
      });
    }
    this.resolveNoneKeyframes();
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/animate/effects.mjs
var effects = [];
function addEffect(effect) {
  invariant(typeof effect.test === "function" && typeof effect.read === "function", "Effects passed to animate.addEffect() need test() and read().", "effect-missing-test");
  removeEffect(effect);
  effects.unshift(effect);
}
function removeEffect(effect) {
  removeItem(effects, effect);
}
function findEffect(subject) {
  return effects.find((effect) => effect.test(subject));
}
function animateValues(getValue, keyframes2, transition = {}, element) {
  const animations = [];
  const { velocity, path } = transition;
  const reduceMotion = transition.reduceMotion ?? element?.shouldReduceMotion;
  if (path?.animateValues && element) {
    keyframes2 = { ...keyframes2 };
    path.animateValues(getValue, keyframes2, transition, 0, animations);
  }
  for (const key in keyframes2) {
    if (key === "transition" || key === "transitionEnd")
      continue;
    const target = keyframes2[key];
    if (target === void 0)
      continue;
    const value = getValue(key);
    const current = value.get();
    if (current !== void 0 && !value.isAnimating() && !Array.isArray(target) && target === current && !velocity) {
      frame.update(() => value.set(target));
      continue;
    }
    value.start(animateMotionValue(key, value, target, reduceMotion && positionalKeys.has(key) ? { type: false } : transition, element));
    value.animation && animations.push(value.animation);
  }
  const { transitionEnd } = keyframes2;
  if (transitionEnd) {
    const applyTransitionEnd = () => frame.update(() => {
      for (const key in transitionEnd) {
        getValue(key).set(transitionEnd[key]);
      }
    });
    animations.length ? Promise.all(animations).then(applyTransitionEnd) : applyTransitionEnd();
  }
  return animations;
}
function animateEffectSubject(effect, subject, keyframes2, transition, element) {
  return animateValues((key) => {
    let value = effect.get(subject, key);
    if (!value) {
      let initial;
      if (!element) {
        const target = keyframes2[key];
        initial = firstKeyframe(target) ?? effect.read(subject, key, target);
        invariant(initial !== void 0, `"${key}" can't be read from the animated subject. Provide [from, to] keyframes.`, "effect-unreadable-value");
      }
      value = motionValue(initial, { owner: element });
      effect(subject, { [key]: value });
    }
    return value;
  }, keyframes2, transition, element);
}
function firstKeyframe(target) {
  const first = Array.isArray(target) ? target[0] : void 0;
  return first === null ? void 0 : first;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/is-html-element.mjs
function isHTMLElement(element) {
  return isObject(element) && "offsetHeight" in element && !("ownerSVGElement" in element);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/is-svg-element.mjs
function isSVGElement(element) {
  return isObject(element) && "ownerSVGElement" in element;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/utils/resolve-elements.mjs
function resolveElements(elementOrSelector, scope, selectorCache) {
  if (elementOrSelector == null) {
    return [];
  }
  if (elementOrSelector instanceof EventTarget) {
    return [elementOrSelector];
  } else if (typeof elementOrSelector === "string") {
    let root2 = document;
    if (scope) {
      root2 = scope.current;
    }
    const elements = selectorCache?.[elementOrSelector] ?? root2.querySelectorAll(elementOrSelector);
    return elements ? Array.from(elements) : [];
  }
  return Array.from(elementOrSelector).filter((element) => element != null);
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/MotionValueState.mjs
var MotionValueState = class {
  /**
   * @param step - The frameloop step renders are scheduled in. Defaults
   * to `frame.render`. Effects that feed a render loop running in
   * `frame.render` (GPU scenes) should write in `frame.preRender`.
   */
  constructor(step = frame.render) {
    this.step = step;
    this.values = /* @__PURE__ */ new Map();
    this.pending = [];
    this.numPending = 0;
    this.flush = () => {
      const { pending, numPending } = this;
      this.numPending = 0;
      for (let i = 0; i < numPending; i++)
        pending[i]();
    };
  }
  /**
   * @param render - Writes the value to the subject. Renders read the
   * motion value directly rather than a cached copy, so there is one
   * place a value lives.
   * @param computed - A value already in this state (e.g. `transform`)
   * whose render should run whenever `value` changes.
   */
  set(name, value, render, computed) {
    this.values.get(name)?.onRemove();
    if (computed) {
      for (const entry of this.values.values()) {
        if (entry.value === computed)
          render = entry.render;
      }
    }
    const onChange = () => render && this.schedule(render);
    value.get() !== void 0 && onChange();
    const cancelOnChange = value.on("change", onChange);
    const onRemove = () => {
      cancelOnChange();
      render && !computed && this.cancel(render);
      this.values.get(name)?.onRemove === onRemove && this.values.delete(name);
    };
    this.values.set(name, {
      value,
      render: computed ? void 0 : render,
      onRemove
    });
    return onRemove;
  }
  get(name) {
    return this.values.get(name)?.value;
  }
  /**
   * Detach every value from this state and return them, so another
   * renderer can take them over. The state stays cached by its effect,
   * so the bound transforms are reset too rather than leaking into
   * values bound later.
   */
  release() {
    const values = /* @__PURE__ */ new Map();
    this.values.forEach((entry, name) => {
      values.set(name, entry.value);
      entry.onRemove();
    });
    this.transformKeys = this.transformValues = void 0;
    return values;
  }
  schedule(render) {
    const { pending, numPending } = this;
    for (let i = 0; i < numPending; i++) {
      if (pending[i] === render)
        return;
    }
    numPending || this.step(this.flush);
    pending[this.numPending++] = render;
  }
  cancel(render) {
    const { pending } = this;
    for (let i = 0; i < this.numPending; i++) {
      if (pending[i] === render) {
        pending[i] = pending[--this.numPending];
        return;
      }
    }
  }
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/utils/create-effect.mjs
function createEffect(addValue, { step, ...options } = {}) {
  const stateCache = /* @__PURE__ */ new WeakMap();
  const effect = (subject, values) => {
    const state = stateCache.get(subject) ?? new MotionValueState(step);
    stateCache.set(subject, state);
    const subscriptions = [];
    for (const key in values) {
      const value = values[key];
      const remove = addValue(subject, state, key, value);
      subscriptions.push(remove);
    }
    return () => {
      for (const cancel of subscriptions)
        cancel();
    };
  };
  return Object.assign(effect, options, {
    get: (subject, key) => stateCache.get(subject)?.get(key),
    flush: (subject) => stateCache.get(subject)?.flush(),
    state: (subject) => stateCache.get(subject)
  });
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/style/transform.mjs
var openers = {};
function buildTransform2(state) {
  let transform = "";
  const { transformKeys: keys = [], transformValues: values = {} } = state;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = values[key].getCurrent();
    if (value === void 0)
      continue;
    const parsed = typeof value === "number" ? value : parseFloat(value);
    if (parsed !== (key.startsWith("scale") ? 1 : 0)) {
      transform += (transform && " ") + (openers[key] || (openers[key] = (translateAlias[key] || key) + "(")) + getValueAsType(value, transformValueTypes[key]) + ")";
    }
  }
  const pathRotation = state.get("pathRotation")?.get();
  if (pathRotation) {
    transform += (transform && " ") + "rotate(" + getValueAsType(pathRotation, transformValueTypes.pathRotation) + ")";
  }
  return transform || "none";
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/style/index.mjs
var originProps = /* @__PURE__ */ new Set(["originX", "originY", "originZ"]);
var styleValue = (state, key) => getValueAsType(state.get(key)?.get(), numberValueTypes[key]);
var addStyleValue = (element, state, key, value) => {
  let render = void 0;
  let computed = void 0;
  if (transformProps.has(key)) {
    if (key !== "pathRotation") {
      const keys = state.transformKeys ?? (state.transformKeys = []);
      (state.transformValues ?? (state.transformValues = {}))[key] = value;
      if (!keys.includes(key)) {
        keys.push(key);
        keys.sort((a, b) => transformPropOrder.indexOf(a) - transformPropOrder.indexOf(b));
      }
    }
    if (!state.get("transform")) {
      if (!isHTMLElement(element) && !state.get("transformBox")) {
        addStyleValue(element, state, "transformBox", new MotionValue("fill-box"));
      }
      state.set("transform", new MotionValue("none"), () => {
        transformGroups.get(element)?.check();
        element.style.transform = buildTransform2(state);
      });
    }
    computed = state.get("transform");
  } else if (originProps.has(key)) {
    if (!state.get("transformOrigin")) {
      state.set("transformOrigin", new MotionValue(""), () => {
        const originX = styleValue(state, "originX") ?? "50%";
        const originY = styleValue(state, "originY") ?? "50%";
        const originZ = styleValue(state, "originZ") ?? 0;
        element.style.transformOrigin = `${originX} ${originY} ${originZ}`;
      });
    }
    computed = state.get("transformOrigin");
  } else if (isCSSVar(key)) {
    render = () => {
      element.style.setProperty(key, value.getCurrent());
    };
  } else {
    render = () => {
      element.style[key] = getValueAsType(value.getCurrent(), numberValueTypes[key]);
    };
  }
  return state.set(key, value, render, computed);
};
var isStyleSubject = (subject) => isHTMLElement(subject) || isSVGElement(subject);
var readStyleValue = (element, key) => {
  if (transformProps.has(key)) {
    return readTransformValue(element, key);
  }
  const computedStyle = getComputedStyle(element);
  const value = isCSSVar(key) ? computedStyle.getPropertyValue(key) : computedStyle[key];
  return typeof value === "string" && value.trim() || 0;
};
var styleSubjectEffect = /* @__PURE__ */ createEffect(addStyleValue, {
  test: isStyleSubject,
  read: readStyleValue
});

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/svg/utils/build-attrs.mjs
var cssStyleProperties = [
  "transform",
  "opacity",
  "clipPath",
  "filter",
  "offsetDistance",
  "offsetPath",
  "offsetRotate",
  "offsetAnchor"
];

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/attr/index.mjs
function canSetAsProperty(element, name) {
  if (!(name in element))
    return false;
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), name) || Object.getOwnPropertyDescriptor(element, name);
  return descriptor && typeof descriptor.set === "function";
}
var addAttrValue = (element, state, key, value, name = key) => {
  const isProp = canSetAsProperty(element, name);
  if (!isProp && (name.startsWith("data") || name.startsWith("aria"))) {
    name = camelToDash(name);
  }
  const type = numberValueTypes[key] || numberValueTypes[name];
  const render = isProp ? () => {
    element[name] = getValueAsType(value.get(), numberValueTypes[key]);
  } : () => {
    const v = getValueAsType(value.get(), type);
    if (v === null || v === void 0) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, String(v));
    }
  };
  return state.set(key, value, render);
};

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/svg/index.mjs
function addSVGPathValue(element, state, key, value) {
  frame.render(() => element.setAttribute("pathLength", "1"));
  if (key === "pathOffset") {
    return state.set(key, value, () => {
      const offset = value.get();
      element.setAttribute("stroke-dashoffset", `${-offset}`);
    });
  } else {
    if (!state.get("stroke-dasharray")) {
      state.set("stroke-dasharray", new MotionValue("1 1"), () => {
        const pathLength = state.get("pathLength")?.get() ?? 1;
        const pathSpacing = state.get("pathSpacing")?.get();
        element.setAttribute("stroke-dasharray", `${pathLength} ${pathSpacing ?? 1 - Number(pathLength)}`);
      });
    }
    return state.set(key, value, void 0, state.get("stroke-dasharray"));
  }
}
var addSVGValue = (element, state, key, value) => {
  if (key.startsWith("path") && !transformProps.has(key)) {
    return addSVGPathValue(element, state, key, value);
  } else if (key.startsWith("attr")) {
    return addAttrValue(element, state, key, value, convertAttrKey(key));
  }
  const handler = transformProps.has(key) || originProps.has(key) || isCSSVar(key) || key in element.style ? addStyleValue : addAttrValue;
  return handler(element, state, key, value);
};
var readSVGValue = (element, key) => {
  if (transformProps.has(key)) {
    return numberValueTypes[key]?.default || 0;
  }
  if (isCSSVar(key) || cssStyleProperties.includes(key)) {
    return readStyleValue(element, key) || element.getAttribute(camelToDash(key)) || 0;
  }
  key = convertAttrKey(key);
  return element.getAttribute(camelToDash(key)) ?? element.getAttribute(key) ?? void 0;
};
var svgSubjectEffect = /* @__PURE__ */ createEffect(addSVGValue, {
  test: isSVGElement,
  read: readSVGValue
});
function convertAttrKey(key) {
  return key.replace(/^attr([A-Z])/, (_, firstChar) => firstChar.toLowerCase());
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/projection/geometry/conversion.mjs
function convertBoundingBoxToBox({ top, left, right, bottom }) {
  return {
    x: { min: left, max: right },
    y: { min: top, max: bottom }
  };
}
function transformBoxPoints(point, transformPoint) {
  if (!transformPoint)
    return point;
  const topLeft = transformPoint({ x: point.left, y: point.top });
  const bottomRight = transformPoint({ x: point.right, y: point.bottom });
  return {
    top: topLeft.y,
    left: topLeft.x,
    bottom: bottomRight.y,
    right: bottomRight.x
  };
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/projection/utils/measure.mjs
function measureViewportBox(instance, transformPoint) {
  return convertBoundingBoxToBox(transformBoxPoints(instance.getBoundingClientRect(), transformPoint));
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/animate/element.mjs
var noProps = {};
var getElementEffect = (element) => isSVGElement(element) ? svgSubjectEffect : styleSubjectEffect;
var EffectSubject = class {
  constructor(effect, current) {
    this.effect = effect;
    this.current = current;
    this.KeyframeResolver = DOMKeyframesResolver;
  }
  getValue(key) {
    return this.effect.get(this.current, key);
  }
  readValue(key, target) {
    return this.effect.read(this.current, key, target);
  }
  render() {
    this.effect.flush(this.current);
  }
  measureViewportBox() {
    return measureViewportBox(this.current);
  }
  getProps() {
    return noProps;
  }
};
function animateElement(element, keyframes2, transition, visualElement) {
  if (visualElement) {
    return animateValues((key) => visualElement.getValue(key, null), keyframes2, transition, visualElement);
  }
  const effect = getElementEffect(element);
  return animateEffectSubject(effect, element, keyframes2, transition, new EffectSubject(effect, element));
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/effects/prop/index.mjs
var propEffect = /* @__PURE__ */ createEffect((subject, state, key, value) => {
  return state.set(key, value, () => {
    subject[key] = value.get();
  });
}, {
  test: (subject) => isObject(subject),
  read: (subject, key) => {
    const value = subject[key];
    return typeof value === "string" || typeof value === "number" ? value : void 0;
  }
});

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/animation/animate/single-value.mjs
function animateSingleValue(value, keyframes2, options) {
  const motionValue$1 = isMotionValue(value) ? value : motionValue(value);
  motionValue$1.start(animateMotionValue("", motionValue$1, keyframes2, options));
  return motionValue$1.animation;
}

// node_modules/.pnpm/motion-dom@14.4.0/node_modules/motion-dom/dist/es/render/store.mjs
var visualElementStore = /* @__PURE__ */ new WeakMap();

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/utils/is-dom-keyframes.mjs
function isDOMKeyframes(keyframes2) {
  return typeof keyframes2 === "object" && !Array.isArray(keyframes2);
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/animate/resolve-subjects.mjs
function resolveSubjects(subject, keyframes2, scope, selectorCache) {
  if (subject == null) {
    return [];
  }
  if (typeof subject === "string" && isDOMKeyframes(keyframes2)) {
    return resolveElements(subject, scope, selectorCache);
  } else if (subject instanceof NodeList) {
    return Array.from(subject);
  } else if (Array.isArray(subject)) {
    return subject.filter((s) => s != null);
  } else {
    return [subject];
  }
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/sequence/utils/calc-repeat-duration.mjs
function calculateRepeatDuration(duration, repeat, repeatDelay) {
  return duration * (repeat + 1) + repeatDelay * repeat;
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/sequence/utils/calc-time.mjs
function calcNextTime(current, next, prev, labels) {
  if (typeof next === "number") {
    return next;
  } else if (next.startsWith("-") || next.startsWith("+")) {
    return Math.max(0, current + parseFloat(next));
  } else if (next === "<") {
    return prev;
  } else if (next.startsWith("<")) {
    return Math.max(0, prev + parseFloat(next.slice(1)));
  } else {
    return labels.get(next) ?? current;
  }
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/sequence/utils/edit.mjs
function eraseKeyframes(sequence, startTime, endTime) {
  for (let i = 0; i < sequence.length; i++) {
    const keyframe = sequence[i];
    if (keyframe.at > startTime && keyframe.at < endTime) {
      removeItem(sequence, keyframe);
      i--;
    }
  }
}
function addKeyframes(sequence, keyframes2, easing, offset, startTime, endTime) {
  eraseKeyframes(sequence, startTime, endTime);
  for (let i = 0; i < keyframes2.length; i++) {
    sequence.push({
      value: keyframes2[i],
      at: mixNumber(startTime, endTime, offset[i]),
      easing: getEasingForSegment(easing, i)
    });
  }
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/sequence/utils/normalize-times.mjs
function normalizeTimes(times, repeat, repeatDelayUnits = 0) {
  const totalUnits = repeat + 1 + repeat * repeatDelayUnits;
  for (let i = 0; i < times.length; i++) {
    times[i] = times[i] / totalUnits;
  }
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/sequence/utils/sort.mjs
function compareByTime(a, b) {
  if (a.at === b.at) {
    if (a.value === null)
      return 1;
    if (b.value === null)
      return -1;
    return 0;
  } else {
    return a.at - b.at;
  }
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/sequence/create.mjs
var defaultSegmentEasing = "easeInOut";
var MAX_REPEAT = 20;
function createAnimationsFromSequence(sequence, { defaultTransition = {}, ...sequenceTransition } = {}, scope, generators) {
  const defaultDuration = defaultTransition.duration || 0.3;
  const animationDefinitions = /* @__PURE__ */ new Map();
  const sequences = /* @__PURE__ */ new Map();
  const elementCache = {};
  const timeLabels = /* @__PURE__ */ new Map();
  let prevTime = 0;
  let currentTime = 0;
  let totalDuration = 0;
  for (let i = 0; i < sequence.length; i++) {
    const segment = sequence[i];
    if (typeof segment === "string") {
      timeLabels.set(segment, currentTime);
      continue;
    } else if (!Array.isArray(segment)) {
      timeLabels.set(segment.name, calcNextTime(currentTime, segment.at, prevTime, timeLabels));
      continue;
    }
    let [subject, keyframes2, transition = {}] = segment;
    if (transition.at !== void 0) {
      currentTime = calcNextTime(currentTime, transition.at, prevTime, timeLabels);
    }
    let maxDuration = 0;
    const resolveValueSequence = (valueKeyframes, valueTransition, valueSequence, elementIndex = 0, numSubjects = 0) => {
      const valueKeyframesAsList = keyframesAsList(valueKeyframes);
      const { delay = 0, times = defaultOffset(valueKeyframesAsList), type = defaultTransition.type || "keyframes", repeat, repeatType, repeatDelay = 0, ...remainingTransition } = valueTransition;
      let { ease: ease2 = defaultTransition.ease || "easeOut", duration } = valueTransition;
      const calculatedDelay = typeof delay === "function" ? delay(elementIndex, numSubjects) : delay;
      const numKeyframes = valueKeyframesAsList.length;
      const createGenerator = isGenerator(type) ? type : generators?.[type || "keyframes"];
      if (numKeyframes <= 2 && createGenerator) {
        let absoluteDelta = 100;
        if (numKeyframes === 2 && isNumberKeyframesArray(valueKeyframesAsList)) {
          const delta = valueKeyframesAsList[1] - valueKeyframesAsList[0];
          absoluteDelta = Math.abs(delta);
        }
        const springTransition = {
          ...defaultTransition,
          ...remainingTransition
        };
        if (duration !== void 0) {
          springTransition.duration = secondsToMilliseconds(duration);
        }
        const springEasing = createGeneratorEasing(springTransition, absoluteDelta, createGenerator);
        ease2 = springEasing.ease;
        duration = springEasing.duration;
      }
      duration ?? (duration = defaultDuration);
      const startTime = currentTime + calculatedDelay;
      if (times.length === 1 && times[0] === 0) {
        times[1] = 1;
      }
      const remainder = times.length - valueKeyframesAsList.length;
      remainder > 0 && fillOffset(times, remainder);
      valueKeyframesAsList.length === 1 && valueKeyframesAsList.unshift(null);
      if (repeat) {
        warning(repeat < MAX_REPEAT, `Sequence segments can't repeat ${repeat} times \u2014 ignoring repeat option. Use a value below ${MAX_REPEAT} or apply repeat at the sequence level instead.`);
      }
      if (repeat && repeat < MAX_REPEAT) {
        const repeatDelayUnits = duration > 0 ? repeatDelay / duration : 0;
        duration = calculateRepeatDuration(duration, repeat, repeatDelay);
        const originalKeyframes = [...valueKeyframesAsList];
        const originalTimes = [...times];
        ease2 = Array.isArray(ease2) ? [...ease2] : [ease2];
        const originalEase = [...ease2];
        const isFlipping = repeatType === "reverse" || repeatType === "mirror";
        let flippedKeyframes = originalKeyframes;
        let flippedEases = originalEase;
        if (isFlipping) {
          flippedKeyframes = [...originalKeyframes].reverse();
          if (repeatType === "reverse") {
            flippedEases = [...originalEase].reverse().map((e) => typeof e === "function" ? reverseEasing(e) : e);
          }
        }
        for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex++) {
          const isFlipped = isFlipping && repeatIndex % 2 === 0;
          const iterKeyframes = isFlipped ? flippedKeyframes : originalKeyframes;
          const iterEase = isFlipped ? flippedEases : originalEase;
          const iterStartOffset = (repeatIndex + 1) * (1 + repeatDelayUnits);
          if (repeatDelayUnits > 0) {
            valueKeyframesAsList.push(valueKeyframesAsList[valueKeyframesAsList.length - 1]);
            times.push(iterStartOffset);
            ease2.push("linear");
          }
          valueKeyframesAsList.push(...iterKeyframes);
          for (let keyframeIndex = 0; keyframeIndex < iterKeyframes.length; keyframeIndex++) {
            times.push(originalTimes[keyframeIndex] + iterStartOffset);
            ease2.push(keyframeIndex === 0 ? "linear" : getEasingForSegment(iterEase, keyframeIndex - 1));
          }
        }
        normalizeTimes(times, repeat, repeatDelayUnits);
      }
      const targetTime = startTime + duration;
      addKeyframes(valueSequence, valueKeyframesAsList, ease2, times, startTime, targetTime);
      maxDuration = Math.max(calculatedDelay + duration, maxDuration);
      totalDuration = Math.max(targetTime, totalDuration);
    };
    if (isMotionValue(subject)) {
      const subjectSequence = getSubjectSequence(subject, sequences);
      resolveValueSequence(keyframes2, transition, getValueSequence("default", subjectSequence));
    } else {
      const subjects = resolveSubjects(subject, keyframes2, scope, elementCache);
      const numSubjects = subjects.length;
      for (let subjectIndex = 0; subjectIndex < numSubjects; subjectIndex++) {
        keyframes2 = keyframes2;
        transition = transition;
        const thisSubject = subjects[subjectIndex];
        const subjectSequence = getSubjectSequence(thisSubject, sequences);
        for (const key in keyframes2) {
          resolveValueSequence(keyframes2[key], getValueTransition2(transition, key), getValueSequence(key, subjectSequence), subjectIndex, numSubjects);
        }
      }
    }
    prevTime = currentTime;
    currentTime += maxDuration;
  }
  sequences.forEach((valueSequences, element) => {
    for (const key in valueSequences) {
      const valueSequence = valueSequences[key];
      valueSequence.sort(compareByTime);
      const keyframes2 = [];
      const valueOffset = [];
      const valueEasing = [];
      for (let i = 0; i < valueSequence.length; i++) {
        const { at, value, easing } = valueSequence[i];
        keyframes2.push(value);
        valueOffset.push(progress(0, totalDuration, at));
        valueEasing.push(easing || "easeOut");
      }
      if (valueOffset[0] !== 0) {
        valueOffset.unshift(0);
        keyframes2.unshift(keyframes2[0]);
        valueEasing.unshift(defaultSegmentEasing);
      }
      if (valueOffset[valueOffset.length - 1] !== 1) {
        valueOffset.push(1);
        keyframes2.push(null);
      }
      if (!animationDefinitions.has(element)) {
        animationDefinitions.set(element, {
          keyframes: {},
          transition: {}
        });
      }
      const definition = animationDefinitions.get(element);
      definition.keyframes[key] = keyframes2;
      const { type: _type, ...remainingDefaultTransition } = defaultTransition;
      definition.transition[key] = {
        ...remainingDefaultTransition,
        duration: totalDuration,
        ease: valueEasing,
        times: valueOffset,
        ...sequenceTransition
      };
    }
  });
  return animationDefinitions;
}
function getSubjectSequence(subject, sequences) {
  !sequences.has(subject) && sequences.set(subject, {});
  return sequences.get(subject);
}
function getValueSequence(name, sequences) {
  if (!sequences[name])
    sequences[name] = [];
  return sequences[name];
}
function keyframesAsList(keyframes2) {
  return Array.isArray(keyframes2) ? keyframes2 : [keyframes2];
}
function getValueTransition2(transition, key) {
  return transition && transition[key] ? {
    ...transition,
    ...transition[key]
  } : { ...transition };
}
var isNumber = (keyframe) => typeof keyframe === "number";
var isNumberKeyframesArray = (keyframes2) => keyframes2.every(isNumber);

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/animate/subject.mjs
function isSingleValue(subject, keyframes2) {
  return isMotionValue(subject) || typeof subject === "number" || typeof subject === "string" && !isDOMKeyframes(keyframes2);
}
function animateSubject(subject, keyframes2, options, scope) {
  const animations = [];
  if (isSingleValue(subject, keyframes2)) {
    animations.push(animateSingleValue(subject, isDOMKeyframes(keyframes2) ? keyframes2.default || keyframes2 : keyframes2, options ? options.default || options : options));
  } else {
    if (subject == null) {
      return animations;
    }
    const subjects = resolveSubjects(subject, keyframes2, scope);
    const numSubjects = subjects.length;
    invariant(Boolean(numSubjects), "No valid elements provided.", "no-valid-elements");
    for (let i = 0; i < numSubjects; i++) {
      const thisSubject = subjects[i];
      const transition = { ...options };
      if ("delay" in transition && typeof transition.delay === "function") {
        transition.delay = transition.delay(i, numSubjects);
      }
      if (thisSubject instanceof Element) {
        animations.push(...animateElement(thisSubject, keyframes2, transition, visualElementStore.get(thisSubject)));
      } else {
        animations.push(...animateEffectSubject(findEffect(thisSubject) ?? propEffect, thisSubject, keyframes2, transition));
      }
    }
  }
  return animations;
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/animate/sequence.mjs
function animateSequence(sequence, options, scope) {
  const animations = [];
  const processedSequence = sequence.map((segment) => {
    if (Array.isArray(segment) && typeof segment[0] === "function") {
      const callback = segment[0];
      const mv = motionValue(0);
      mv.on("change", callback);
      if (segment.length === 1) {
        return [mv, [0, 1]];
      } else if (segment.length === 2) {
        return [mv, [0, 1], segment[1]];
      } else {
        return [mv, segment[1], segment[2]];
      }
    }
    return segment;
  });
  const animationDefinitions = createAnimationsFromSequence(processedSequence, options, scope, { spring });
  animationDefinitions.forEach(({ keyframes: keyframes2, transition }, subject) => {
    animations.push(...animateSubject(subject, keyframes2, transition));
  });
  return animations;
}

// node_modules/.pnpm/framer-motion@14.4.0/node_modules/framer-motion/dist/es/animation/animate/index.mjs
function isSequence(value) {
  return Array.isArray(value) && value.some(Array.isArray);
}
function createScopedAnimate(options = {}) {
  const { scope, reduceMotion, skipAnimations } = options;
  function scopedAnimate(subjectOrSequence, optionsOrKeyframes, options2) {
    let animations = [];
    let animationOnComplete;
    const inherited = {};
    if (reduceMotion !== void 0)
      inherited.reduceMotion = reduceMotion;
    if (skipAnimations !== void 0)
      inherited.skipAnimations = skipAnimations;
    if (isSequence(subjectOrSequence)) {
      const { onComplete, ...sequenceOptions } = optionsOrKeyframes || {};
      if (typeof onComplete === "function") {
        animationOnComplete = onComplete;
      }
      animations = animateSequence(subjectOrSequence, { ...inherited, ...sequenceOptions }, scope);
    } else {
      const { onComplete, ...rest } = options2 || {};
      if (typeof onComplete === "function") {
        animationOnComplete = onComplete;
      }
      animations = animateSubject(subjectOrSequence, optionsOrKeyframes, { ...inherited, ...rest }, scope);
    }
    const animation = new GroupAnimationWithThen(animations);
    if (animationOnComplete) {
      animation.finished.then(animationOnComplete);
    }
    if (scope) {
      scope.animations.push(animation);
      animation.finished.then(() => {
        removeItem(scope.animations, animation);
      });
    }
    return animation;
  }
  return scopedAnimate;
}
var animate = Object.assign(createScopedAnimate(), {
  /**
   * Register an effect so `animate()` can animate the subjects it
   * claims, for instance `animate.addEffect(threeEffect)`. The most
   * recently added effect is tested first. DOM elements are always
   * animated directly.
   */
  addEffect,
  removeEffect
});

// frontend/illustration-layer.js
var serial = 0;
var ns = "http://www.w3.org/2000/svg";
var shapeTags = "path,circle,ellipse,line,polyline,polygon,rect";
function mountPencilDrawing(container, drawing, { reducedMotion = false } = {}) {
  const doc = new DOMParser().parseFromString(drawing.svg, "image/svg+xml");
  const svg = document.importNode(doc.documentElement, true);
  const tags = /* @__PURE__ */ new Set(["svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect"]);
  const attributes = /* @__PURE__ */ new Set(["xmlns", "viewBox", "width", "height", "d", "points", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "transform"]);
  if (svg.localName !== "svg" || svg.getAttribute("viewBox") !== "0 0 80 80" || [...svg.querySelectorAll("*"), svg].some((el) => !tags.has(el.localName) || [...el.attributes].some((a) => !attributes.has(a.name) || /url\s*\(|javascript:|https?:/i.test(a.value) && a.name !== "xmlns"))) {
    throw new Error("Unsafe illustration rejected.");
  }
  svg.setAttribute("width", "160");
  svg.setAttribute("height", "160");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Pencil drawing of ${drawing.concept}`);
  svg.style.cssText = "display:block;overflow:visible;mix-blend-mode:multiply;";
  const id = `pencil-grain-${++serial}`;
  const defs = document.createElementNS(ns, "defs");
  defs.innerHTML = `<filter id="${id}" filterUnits="userSpaceOnUse" x="-4" y="-4" width="88" height="88"><feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="2" seed="11" result="wobble"/><feDisplacementMap in="SourceGraphic" in2="wobble" scale=".65" xChannelSelector="R" yChannelSelector="G" result="pencil"/><feTurbulence type="fractalNoise" baseFrequency=".68" numOctaves="2" seed="7" result="grain"/><feColorMatrix in="grain" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .65 .35" result="tooth"/><feComposite in="pencil" in2="tooth" operator="in"/></filter>`;
  const group = document.createElementNS(ns, "g");
  while (svg.firstChild) group.append(svg.firstChild);
  svg.append(defs, group);
  const strokes = [...group.querySelectorAll(shapeTags)];
  strokes.forEach((stroke) => stroke.setAttribute("filter", `url(#${id})`));
  const controls = [];
  let settled = false;
  const displacement = defs.querySelector("feDisplacementMap");
  function finish() {
    if (settled) return;
    settled = true;
    controls.forEach((control) => control.stop());
    strokes.forEach((el) => {
      el.style.strokeDasharray = "";
      el.style.strokeDashoffset = "";
    });
    displacement.setAttribute("scale", ".65");
  }
  container.replaceChildren(svg);
  if (!reducedMotion) {
    strokes.forEach((el, index) => {
      let length = 100;
      try {
        length = el.getTotalLength?.() || 100;
      } catch {
      }
      el.style.strokeDasharray = `${length} ${length}`;
      el.style.strokeDashoffset = String(length);
      controls.push(animate(el, { strokeDashoffset: [length, 0] }, { duration: 0.22, delay: index * 0.018, ease: "easeOut" }));
    });
    controls.push(animate(1.4, 0.65, { duration: 0.55, onUpdate: (value) => displacement.setAttribute("scale", String(value)) }));
  }
  return { svg, finish, dispose() {
    finish();
    svg.remove();
  } };
}

// frontend/illustration-proof.js
var root = "/static/illustration-proof/benchmark-20261020/";
var report = await fetch(`${root}results.json`, { cache: "no-store" }).then((r) => r.json());
var page = document.querySelector("main");
var summary = document.querySelector("#summary");
var mounted = [];
var client = [];
var reducedToggle = document.querySelector("#reduce-motion");
reducedToggle.checked = matchMedia("(prefers-reduced-motion: reduce)").matches;
reducedToggle.addEventListener("change", () => {
  for (const entry of mounted) {
    entry.current.dispose();
    entry.current = mountPencilDrawing(entry.holder, entry.drawing, { reducedMotion: reducedToggle.checked });
  }
});
var shortName = (model) => model.includes("opus") ? "Opus 5.5" : model.endsWith("-image") ? "Nano Banana Lite" : "Gemini Flash-Lite";
var money = (value) => value == null ? "unreported" : `$${Number(value).toFixed(6)}`;
var table = document.createElement("table");
var head = document.createElement("thead");
head.innerHTML = "<tr><th>Model / native output</th><th>Subject</th><th>API response</th><th>Saved + validated</th><th>Actual USD</th><th>Output size</th></tr>";
table.append(head);
var body = document.createElement("tbody");
table.append(body);
summary.append(table);
var successful = report.runs.filter((run) => run.status === "ok");
for (const run of successful) {
  const row = document.createElement("tr");
  const values = [`${shortName(run.model)} / ${run.kind.toUpperCase()}`, run.subject, `${((run.response_ms ?? run.ready_ms) / 1e3).toFixed(2)}s`, `${(run.ready_ms / 1e3).toFixed(2)}s`, money(run.cost_usd), run.status === "ok" ? `${(run.asset_bytes / 1024).toFixed(1)} KB \xB7 ${run.dimensions.join("\xD7")}` : run.error];
  values.forEach((value) => {
    const td = document.createElement("td");
    td.textContent = value;
    row.append(td);
  });
  body.append(row);
}
var serial2 = 0;
function mountRaster(holder, src, concept) {
  const id = `raster-wobble-${++serial2}`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 80 80");
  svg.setAttribute("width", "160");
  svg.setAttribute("height", "160");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", concept);
  svg.style.mixBlendMode = "multiply";
  svg.innerHTML = `<defs><filter id="${id}" filterUnits="userSpaceOnUse" x="-4" y="-4" width="88" height="88"><feTurbulence type="fractalNoise" baseFrequency=".085" numOctaves="2" seed="11"/><feDisplacementMap in="SourceGraphic" scale=".65" xChannelSelector="R" yChannelSelector="G"/></filter></defs>`;
  const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
  image.setAttribute("href", src);
  image.setAttribute("width", "80");
  image.setAttribute("height", "80");
  image.setAttribute("filter", `url(#${id})`);
  svg.append(image);
  holder.append(svg);
}
for (const run of successful) {
  let column = function(label2) {
    const figure = document.createElement("figure");
    const holder2 = document.createElement("div");
    holder2.className = "drawing";
    const caption = document.createElement("figcaption");
    caption.textContent = label2;
    figure.append(holder2, caption);
    previews.append(figure);
    return holder2;
  };
  const article = document.createElement("article");
  const title = document.createElement("h2");
  title.textContent = `${shortName(run.model)} \xB7 ${run.kind.toUpperCase()} \xB7 ${run.subject}`;
  const status = document.createElement("p");
  status.className = "metrics";
  status.textContent = `${(run.ready_ms / 1e3).toFixed(2)}s \xB7 ${money(run.cost_usd)} \xB7 ${run.concept}`;
  article.append(title, status);
  page.append(article);
  if (run.status !== "ok") {
    const error = document.createElement("p");
    error.textContent = run.error;
    article.append(error);
    continue;
  }
  const previews = document.createElement("div");
  previews.className = "previews";
  article.append(previews);
  const started = performance.now();
  const response = await fetch(root + run.file);
  const blob = await response.blob();
  const fetched = performance.now();
  let source;
  if (run.kind === "svg") {
    const svg = await blob.text();
    const holder2 = column("Native SVG \xB7 160px");
    const drawing = { svg, concept: run.concept };
    mounted.push({ holder: holder2, drawing, current: mountPencilDrawing(holder2, drawing, { reducedMotion: reducedToggle.checked }) });
    source = new Blob([svg], { type: "image/svg+xml" });
  } else {
    const holder2 = column(`Native ${run.dimensions[0]}px \xB7 shown 160px`);
    mountRaster(holder2, URL.createObjectURL(blob), `Native raster of ${run.concept}`);
    source = blob;
  }
  const image = new Image();
  const url = URL.createObjectURL(source);
  image.src = url;
  await image.decode();
  const decoded = performance.now();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 80;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 80, 80);
  ctx.drawImage(image, 0, 0, 80, 80);
  const dataURL = canvas.toDataURL("image/png");
  const processed = performance.now();
  const holder = column(run.kind === "svg" ? "Rasterized SVG \xB7 80px \u2192 160px" : "Downscaled raster \xB7 80px \u2192 160px");
  mountRaster(holder, dataURL, `80px rendition of ${run.concept}`);
  URL.revokeObjectURL(url);
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  client.push({ id: run.id, fetch_ms: +(fetched - started).toFixed(2), decode_and_mount_ms: +(decoded - fetched).toFixed(2), resize_encode_ms: +(processed - decoded).toFixed(2), local_first_paint_ms: +(performance.now() - started).toFixed(2), raster_80_bytes: Math.floor((dataURL.length - dataURL.indexOf(",") - 1) * 0.75) });
}
var footer = document.querySelector("#details");
var total = document.createElement("p");
total.textContent = `Total provider-reported cost: ${money(report.total_reported_cost_usd)}. ${report.runs.length} live calls total, including rejected output attempts; two subjects per successful output path. All previews use multiply and subtle displacement. No application-cache reuse or hidden retries.`;
footer.append(total);
var details = document.createElement("details");
var label = document.createElement("summary");
label.textContent = "Exact prompts, token usage, timing definitions and local rendering measurements";
var data = document.createElement("pre");
data.id = "benchmark-details";
data.textContent = JSON.stringify({ ...report, browser_measurements: client }, null, 2);
details.append(label, data);
footer.append(details);
var failures = document.createElement("p");
failures.textContent = `Rejected attempts (included in total): ${report.runs.filter((run) => run.status !== "ok").map((run) => `${shortName(run.model)} ${run.kind}/${run.subject}: ${(run.ready_ms / 1e3).toFixed(2)}s, ${money(run.cost_usd)} \u2014 ${run.error}`).join("; ")}.`;
footer.append(failures);
var unsupported = document.createElement("p");
unsupported.textContent = "Flash-Lite and Opus have no native raster output. Their 80px previews are local SVG conversions, not separate image generations. Nano Banana Lite generates at 1024px minimum; reducing to 80px does not lower the API bill. Costs are API-reported USD. Two prompts are a comparison sample, not p95 or a reliability estimate.";
footer.append(unsupported);
