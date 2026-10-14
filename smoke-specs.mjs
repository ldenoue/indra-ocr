export function smokeSpecs(ort) {
  const line = () => ({
    x: new ort.Tensor('float32', new Float32Array(32 * 64), [1, 1, 32, 64]),
    widths: new ort.Tensor('int64', new BigInt64Array([64n]), [1]),
  });
  const mathLine = height => ({
    x: new ort.Tensor('float32', new Float32Array(height * 64), [1, 1, height, 64]),
    widths: new ort.Tensor('int64', new BigInt64Array([64n]), [1]),
  });
  const emptyCache = () => new ort.Tensor('float32', new Float32Array(0), [3, 1, 8, 0, 24]);
  const crossCache = () => new ort.Tensor('float32', new Float32Array(3 * 1 * 8 * 2 * 24), [3, 1, 8, 2, 24]);
  return {
    'det.onnx': () => ({x: new ort.Tensor('float32', new Float32Array(32 * 32), [1, 1, 32, 32])}),
    'orient.onnx': () => ({x: new ort.Tensor('float32', new Float32Array(768 * 768), [1, 1, 768, 768])}),
    'rec.onnx': line,
    'rec_cjk.onnx': line,
    'script.onnx': line,
    'order.onnx': () => ({
      feats: new ort.Tensor('float32', new Float32Array(2 * 16), [1, 2, 16]),
      mask: new ort.Tensor('bool', new Uint8Array([1, 1]), [1, 2]),
    }),
    'mathcls.onnx': () => mathLine(32),
    'math_enc.onnx': () => mathLine(64),
    'math_dec_init.onnx': () => ({
      memory: new ort.Tensor('float32', new Float32Array(2 * 192), [1, 2, 192]),
    }),
    'math_dec_step.onnx': () => ({
      token: new ort.Tensor('int64', new BigInt64Array([1n]), [1]),
      pos: new ort.Tensor('int64', new BigInt64Array([0n]), []),
      self_k: emptyCache(), self_v: emptyCache(),
      cross_k: crossCache(), cross_v: crossCache(),
      mask: new ort.Tensor('float32', new Float32Array([1, 1]), [1, 2]),
    }),
  };
}
