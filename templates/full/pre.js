// Keep the module from the pinned Emscripten factory's own asset load.
if (!Module['compiledWasm']) {
  var instantiateFromAsset = instantiateAsync;
  instantiateAsync = async (...args) => {
    var result = await instantiateFromAsset(...args);
    Module['compiledWasm'] = result.module;
    return result;
  };
} else {
  Module['instantiateWasm'] = (imports, receive) => {
    try {
      receive(new WebAssembly.Instance(Module['compiledWasm'], imports));
      // This build has no main or startup hooks. Initialize libc and stdio
      // now, then skip the deferred run() so it cannot initialize them twice.
      initRuntime();
      run = () => {};
      Module['readySync'] = true;
    } catch (error) {
      Module['initError'] = error;
      throw error;
    }
  };
}
