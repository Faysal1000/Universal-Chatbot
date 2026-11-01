# Vendored: NVIDIA Nemotron Parse post-processing

- Source: Hugging Face repository `nvidia/Nemotron-3.5-Parse`, directory `nemotron_parse/`
- Revision: `4035ffb1d8f8bafcdb867dfaf6f7514f101464f9`
- Licence: OpenMDW-1.1 (see `LICENSE` in this directory). Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
- Files: only the pure-Python post-processing path (`postprocess_document` and its imports). The
  inference, batching and image-geometry modules (which need PyTorch, NumPy or Pillow) are not vendored.
- Integrity: every file is byte-identical to the pinned revision. `SHA256SUMS` lists their digests and
  `tests/unit/test_vendored_nemotron.py` fails on any local edit. Re-vendor or check the remote with
  `python scripts/vendor_nemotron_postprocessing.py --write | --verify`.
