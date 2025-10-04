### ⚙️ TL;DR — Serving the `.wasm` File

The core issue isn’t the library — it’s that the **`.wasm` file lives in `node_modules` and isn’t automatically served** by Next.js, Webpack, or Turbopack.
You just need to make sure it’s fetchable at runtime.

#### ✅ Easiest Fix

Copy the `.wasm` file once and serve it from `/public`:

```bash
cp node_modules/libpg-query/wasm/libpg-query.wasm public/
```

#### ⚠️ Why

Bundlers don’t emit `.wasm` files by default — they stay inside `node_modules`, so the runtime can’t fetch them.

#### 🧩 Workarounds

* **Next.js + Webpack:** Add a `.wasm` asset rule or use the copy method.
* **Turbopack:** Only the copy method works for now.
* **Dev mode:** Optionally use a watcher script to auto-copy on rebuilds.