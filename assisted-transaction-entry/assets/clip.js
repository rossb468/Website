/* ------------------------------------------------------------------
   clip.js — optional zero-shot vision, running in the browser
   ------------------------------------------------------------------
   The heuristic classifier in vision.js measures real things about the
   pixels, but it is still a pile of hand-tuned ramps, and the brand
   palette matcher is openly a stand-in for logo recognition. This is
   the real version of both: OpenAI's CLIP, run locally through
   Transformers.js — ONNX weights, WebGPU or WASM, no API key, no
   server, nothing leaving the browser.

   Zero-shot means there is no training step. CLIP embeds the image and
   embeds a list of candidate captions into the same space, and the
   closest caption wins. That buys two things the heuristics can't do:

     1. A classification that understands content rather than contrast.
     2. A category read straight off a picture with no text in it —
        a plate of food is "a restaurant meal" to CLIP, and nothing
        else in this prototype can reach that conclusion.

   It costs a model download (~90 MB, cached afterwards), so it is
   off by default and the heuristics remain the baseline. When it is
   on, both verdicts are shown side by side — which is the interesting
   comparison anyway.
------------------------------------------------------------------- */

(function () {
  'use strict';

  const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';
  const MODEL = 'Xenova/clip-vit-base-patch32';

  /* CLIP always picks the best caption from the list it is given, so the
     list has to span the space — there is no "none of the above". Several
     captions map onto the same kind, and their probabilities are summed. */
  const KIND_PROMPTS = [
    ['a paper receipt with printed text',            'receipt'],
    ['a printed shop bill or till slip',             'receipt'],
    ['a screenshot of an order confirmation',        'receipt'],
    ['the outside of a shop, seen from the street',  'storefront'],
    ['a large store sign with the shop name on it',  'storefront'],
    ['a packaged product on a table',                'product'],
    ['groceries and shopping bought from a shop',    'product'],
    ['a meal on a plate',                            'product'],
    ['a person or an animal',                        'other'],
    ['a landscape or a view of the sky',             'other'],
    ['a screenshot of an app or a website',          'other']
  ];

  /* Only categories with a visual signature. Subscriptions, bills and
     gifts look like nothing in particular, so asking is just noise. */
  const CATEGORY_PROMPTS = [
    ['fresh groceries and supermarket food shopping',      'groceries'],
    ['a restaurant meal or prepared food',                 'dining'],
    ['a cup of coffee from a cafe',                        'coffee'],
    ['a petrol station and fuel pumps',                    'fuel'],
    ['a train, bus or taxi',                               'transit'],
    ['clothing, electronics or household goods',           'shopping'],
    ['tools, timber and home improvement supplies',        'home'],
    ['medicine and pharmacy products',                     'health'],
    ['a cinema, theatre or concert venue',                 'entertainment'],
    ['a barbershop, hair salon or toiletries',             'personal'],
    ['pet food and pet supplies',                          'pets'],
    ['a hotel, an airport or luggage',                     'travel']
  ];

  let pipelinePromise = null;
  let backend = null;

  /** Loads Transformers.js and warms the model. Cached after the first call. */
  function ensurePipeline(onProgress) {
    if (pipelinePromise) return pipelinePromise;

    pipelinePromise = (async () => {
      const { pipeline } = await import(/* webpackIgnore: true */ CDN);

      // WebGPU is several times faster where it exists; q8 weights keep the
      // download to something a portfolio page can justify asking for.
      const attempts = [];
      if (typeof navigator !== 'undefined' && navigator.gpu) {
        attempts.push({ device: 'webgpu', dtype: 'q8', label: 'WebGPU' });
      }
      attempts.push({ device: 'wasm', dtype: 'q8', label: 'WASM' });

      let lastError = null;
      for (const attempt of attempts) {
        try {
          const pipe = await pipeline('zero-shot-image-classification', MODEL, {
            device: attempt.device,
            dtype: attempt.dtype,
            progress_callback: p => {
              if (onProgress && p && p.status === 'progress' && p.total) {
                onProgress(p.loaded / p.total, attempt.label);
              }
            }
          });
          backend = attempt.label;
          return pipe;
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError || new Error('Could not start the vision model');
    })().catch(err => { pipelinePromise = null; throw err; });

    return pipelinePromise;
  }

  /** Sums the scores of every caption that maps to the same key. */
  function collapse(results, prompts) {
    const byPrompt = Object.fromEntries(prompts);
    const totals = {};
    results.forEach(r => {
      const key = byPrompt[r.label];
      if (key) totals[key] = (totals[key] || 0) + r.score;
    });
    const sum = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    Object.keys(totals).forEach(k => { totals[k] /= sum; });
    return totals;
  }

  /**
   * Runs both prompt sets over one image.
   * @param {HTMLCanvasElement} canvas the already-downscaled frame
   * @returns {{kinds:object, categories:object, top:string, confidence:number, backend:string}}
   */
  async function classify(canvas, onProgress) {
    const pipe = await ensurePipeline(onProgress);

    // Two passes over the same image embedding — the vision encoder is the
    // expensive half, and the library caches nothing between calls, so this
    // is two forward passes rather than one. Still well under a second.
    const kindRaw = await pipe(canvas, KIND_PROMPTS.map(p => p[0]), {
      hypothesis_template: 'a photo of {}'
    });
    const categoryRaw = await pipe(canvas, CATEGORY_PROMPTS.map(p => p[0]), {
      hypothesis_template: 'a photo of {}'
    });

    const kinds = collapse(kindRaw, KIND_PROMPTS);
    const categories = collapse(categoryRaw, CATEGORY_PROMPTS);
    const top = Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])[0];

    return {
      kinds, categories, top,
      confidence: kinds[top] || 0,
      backend,
      captions: {
        kind: kindRaw.slice(0, 3),
        category: categoryRaw.slice(0, 3)
      }
    };
  }

  /**
   * Weighted geometric blend of the two opinions. Geometric rather than
   * arithmetic because it needs both to agree: a kind either model considers
   * near-impossible stays near-impossible, which is the behaviour you want
   * when one of them is confidently wrong.
   */
  function blend(heuristic, model, modelWeight) {
    const w = modelWeight == null ? 0.65 : modelWeight;
    const out = {};
    let sum = 0;
    Object.keys(heuristic).forEach(kind => {
      const h = Math.max(1e-4, heuristic[kind]);
      const m = Math.max(1e-4, model[kind] || 0);
      out[kind] = Math.pow(h, 1 - w) * Math.pow(m, w);
      sum += out[kind];
    });
    Object.keys(out).forEach(k => { out[k] /= sum; });
    return out;
  }

  window.ClipVision = {
    classify, blend, ensurePipeline,
    MODEL, KIND_PROMPTS, CATEGORY_PROMPTS,
    get backend() { return backend; },
    get loaded() { return pipelinePromise != null; }
  };
})();
