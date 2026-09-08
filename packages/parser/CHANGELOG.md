# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## 1.0.1-alpha.1 (2026-09-08)

- refactor(validator)!: remove CLI layer and fix URI resolution (#11) ([76f8556](https://github.com/usearazzo/arazzo-toolkit/commit/76f8556bbece403c38dc8f68e020ab359fee563c)), closes [#11](https://github.com/usearazzo/arazzo-toolkit/issues/11)

### Bug Fixes

- **parser:** distinguish shared source descriptions from cycles ([#142](https://github.com/usearazzo/arazzo-toolkit/issues/142)) ([8c5bc7d](https://github.com/usearazzo/arazzo-toolkit/commit/8c5bc7d82181f90a11a4168bfd4ce8070c007439)), closes [#139](https://github.com/usearazzo/arazzo-toolkit/issues/139)
- **parser:** make README shorter and more appealing ([0f650c1](https://github.com/usearazzo/arazzo-toolkit/commit/0f650c1c906372492cf313d40ab7eec2a1c379ab))
- **parser:** scope MemoryResolver to the exact URI it serves ([#136](https://github.com/usearazzo/arazzo-toolkit/issues/136)) ([3bbf8e1](https://github.com/usearazzo/arazzo-toolkit/commit/3bbf8e1919890828fff286d77a6b2e5186b84b15)), closes [#135](https://github.com/usearazzo/arazzo-toolkit/issues/135)

### Features

- **parser:** add runtime expression and criterion condition parsing ([#130](https://github.com/usearazzo/arazzo-toolkit/issues/130)) ([9f1a239](https://github.com/usearazzo/arazzo-toolkit/commit/9f1a239de4dd74d55795a5142525860142429eaf)), closes [#99](https://github.com/usearazzo/arazzo-toolkit/issues/99)
- **parser:** export ParseError from package entry point ([#141](https://github.com/usearazzo/arazzo-toolkit/issues/141)) ([177fb0f](https://github.com/usearazzo/arazzo-toolkit/commit/177fb0f143600a7ae2edd5349e27c2c292945d54)), closes [#140](https://github.com/usearazzo/arazzo-toolkit/issues/140)
- **parser:** honor resolve.baseURI for object and inline input ([#138](https://github.com/usearazzo/arazzo-toolkit/issues/138)) ([4dcd5d6](https://github.com/usearazzo/arazzo-toolkit/commit/4dcd5d6512f4b099e2ec3321d2b72948372ae55e)), closes [#137](https://github.com/usearazzo/arazzo-toolkit/issues/137)

### BREAKING CHANGES

- the arazzo-validator binary is no longer published.
  Use the programmatic API (validateURI/validate) instead.
