# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.0.1-alpha.15](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.14...v1.0.1-alpha.15) (2026-10-28)

### Bug Fixes

- **runner:** reject an unreadable successCriteria before any request ([#284](https://github.com/usearazzo/arazzo-toolkit/issues/284)) ([11662f5](https://github.com/usearazzo/arazzo-toolkit/commit/11662f5e603909e356e95f0daa85a7e245667920)), closes [#127](https://github.com/usearazzo/arazzo-toolkit/issues/127)

## [1.0.1-alpha.14](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.13...v1.0.1-alpha.14) (2026-10-27)

### Bug Fixes

- **runner:** reject a parameter location outside the defined set ([#283](https://github.com/usearazzo/arazzo-toolkit/issues/283)) ([250f6bf](https://github.com/usearazzo/arazzo-toolkit/commit/250f6bf6a23bbb8b2f305480dc3d728d419e3017)), closes [#126](https://github.com/usearazzo/arazzo-toolkit/issues/126)

## [1.0.1-alpha.13](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.12...v1.0.1-alpha.13) (2026-10-27)

### Bug Fixes

- **runner:** send step parameters the operation does not declare ([#279](https://github.com/usearazzo/arazzo-toolkit/issues/279)) ([5bcb78f](https://github.com/usearazzo/arazzo-toolkit/commit/5bcb78f594bc0a53f8f3288d9b9c0ff0001219f7)), closes [#273](https://github.com/usearazzo/arazzo-toolkit/issues/273)

## [1.0.1-alpha.12](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.11...v1.0.1-alpha.12) (2026-10-27)

### Bug Fixes

- **runner:** read the response body via text(), blob() and bytes() ([#278](https://github.com/usearazzo/arazzo-toolkit/issues/278)) ([c6f0250](https://github.com/usearazzo/arazzo-toolkit/commit/c6f0250ba89a44c44202b16849ccad820d0da482)), closes [#264](https://github.com/usearazzo/arazzo-toolkit/issues/264)

### BREAKING CHANGES

- **runner:** the OpenAPIOperationResponse.text field is replaced by
  the text(), blob() and bytes() methods, and the constructor takes the
  body as content instead of text.

## [1.0.1-alpha.11](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.10...v1.0.1-alpha.11) (2026-10-25)

### Features

- **runner:** add ArazzoRunner entry facade ([#271](https://github.com/usearazzo/arazzo-toolkit/issues/271)) ([3d88c2a](https://github.com/usearazzo/arazzo-toolkit/commit/3d88c2a09c797b73f44c1ba00030ddcded987695))

## [1.0.1-alpha.10](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.9...v1.0.1-alpha.10) (2026-10-23)

### Bug Fixes

- **runner:** match declared media types carrying parameters ([#265](https://github.com/usearazzo/arazzo-toolkit/issues/265)) ([54c597f](https://github.com/usearazzo/arazzo-toolkit/commit/54c597f41736a583a08a4844afd1ca58a62e3895)), closes [#260](https://github.com/usearazzo/arazzo-toolkit/issues/260)

## [1.0.1-alpha.9](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.8...v1.0.1-alpha.9) (2026-10-22)

### Bug Fixes

- **release:** publish serially with a longer sigstore timeout ([ea02ce2](https://github.com/usearazzo/arazzo-toolkit/commit/ea02ce2e69871b5580c86f50aacb20cf45746a04))

## [1.0.1-alpha.8](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.7...v1.0.1-alpha.8) (2026-10-22)

### Bug Fixes

- **runner:** emit CommonJS build of vendored swagger-client ([#255](https://github.com/usearazzo/arazzo-toolkit/issues/255)) ([b4009c2](https://github.com/usearazzo/arazzo-toolkit/commit/b4009c2cda888f11c2dca9606cbc313f1150fff0)), closes [#234](https://github.com/usearazzo/arazzo-toolkit/issues/234)
- **runner:** evaluate runtime expressions in request payloads ([#227](https://github.com/usearazzo/arazzo-toolkit/issues/227)) ([38b7eb0](https://github.com/usearazzo/arazzo-toolkit/commit/38b7eb0036014994180ac35ba0e832d971f73ea1)), closes [#129](https://github.com/usearazzo/arazzo-toolkit/issues/129)
- **runner:** keep response header values as sent ([#259](https://github.com/usearazzo/arazzo-toolkit/issues/259)) ([a8f258e](https://github.com/usearazzo/arazzo-toolkit/commit/a8f258e851772b746804aa3c62a8c7ab0b2429f0)), closes [#258](https://github.com/usearazzo/arazzo-toolkit/issues/258)
- **runner:** keep SpecLynx ApiDOM external in swagger-client bundle ([#257](https://github.com/usearazzo/arazzo-toolkit/issues/257)) ([8c39d12](https://github.com/usearazzo/arazzo-toolkit/commit/8c39d12e692a896ef9038ab67b76787283844c07))
- utilize latest SpecLynx brekaing releases ([32fae0e](https://github.com/usearazzo/arazzo-toolkit/commit/32fae0e73495ea81d0024b42dcd992cb9c34713d))

### Features

- **runner:** export SourceDescriptionsLocatorNormalizer ([9387076](https://github.com/usearazzo/arazzo-toolkit/commit/9387076238df3f89767a8b65c92e5d59443e351d))
- **runner:** run petstore workflows e2e and publish the runner ([#233](https://github.com/usearazzo/arazzo-toolkit/issues/233)) ([aaf9cbc](https://github.com/usearazzo/arazzo-toolkit/commit/aaf9cbc50f328a99b32665fdfff6755588a20260)), closes [#79](https://github.com/usearazzo/arazzo-toolkit/issues/79)
- **runner:** treat a called workflow as its step's result ([#230](https://github.com/usearazzo/arazzo-toolkit/issues/230)) ([05d996b](https://github.com/usearazzo/arazzo-toolkit/commit/05d996b54505f33b7e652e2bc4e2ebb4d2f7e600)), closes [#228](https://github.com/usearazzo/arazzo-toolkit/issues/228)

## [1.0.1-alpha.7](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.6...v1.0.1-alpha.7) (2026-10-10)

### Features

- **cli:** add @usearazzo/cli package with validate command ([#220](https://github.com/usearazzo/arazzo-toolkit/issues/220)) ([b9fb613](https://github.com/usearazzo/arazzo-toolkit/commit/b9fb6131b6005a4bb49afbe3314466604465f836)), closes [#84](https://github.com/usearazzo/arazzo-toolkit/issues/84)
- publish @usearazzo/cli via trusted publishing ([f28900a](https://github.com/usearazzo/arazzo-toolkit/commit/f28900a9f117577bc373e72a3fb28640ed2ada31))

## [1.0.1-alpha.6](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.5...v1.0.1-alpha.6) (2026-10-04)

### Bug Fixes

- **validator:** check Arazzo 1.1.0 documents against JSON Schema ([#202](https://github.com/usearazzo/arazzo-toolkit/issues/202)) ([eb86d9c](https://github.com/usearazzo/arazzo-toolkit/commit/eb86d9c4fb6cd5369c333c2a3ae9a84057b18477))
- **validator:** install the workspace parser, not alpha.2 ([#203](https://github.com/usearazzo/arazzo-toolkit/issues/203)) ([11f205a](https://github.com/usearazzo/arazzo-toolkit/commit/11f205a1d9a7150a7511e07caf7fdabc910a68e2)), closes [#201](https://github.com/usearazzo/arazzo-toolkit/issues/201)

### Features

- release @userazzo/validator using trusted publishing ([ac614d0](https://github.com/usearazzo/arazzo-toolkit/commit/ac614d04c6c6d0c7a3824d5b70ff8d1540713ee9))
- **validator:** align validator with parser and resolver ([#201](https://github.com/usearazzo/arazzo-toolkit/issues/201)) ([2f44d9a](https://github.com/usearazzo/arazzo-toolkit/commit/2f44d9a04ab2ca55dbe5bc3177733151e46e38ea)), closes [#197](https://github.com/usearazzo/arazzo-toolkit/issues/197) [usearazzo/website#28](https://github.com/usearazzo/website/issues/28)

## [1.0.1-alpha.5](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.4...v1.0.1-alpha.5) (2026-09-24)

### Bug Fixes

- **docs:** add documentation section to parser and resolver READMEs ([#184](https://github.com/usearazzo/arazzo-toolkit/issues/184)) ([f3a7f89](https://github.com/usearazzo/arazzo-toolkit/commit/f3a7f89900c5a002116c91c0c628ca120dc4f97a))

## [1.0.1-alpha.4](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.3...v1.0.1-alpha.4) (2026-09-19)

### Features

- release @usearazzo/resolver ([fa1952a](https://github.com/usearazzo/arazzo-toolkit/commit/fa1952a42f94c5b199883750809afca65480f43f))

## [1.0.1-alpha.3](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.2...v1.0.1-alpha.3) (2026-09-19)

### Bug Fixes

- **resolver:** bump apidom to 5.2.5 to rebase bundled schema $ref ([#167](https://github.com/usearazzo/arazzo-toolkit/issues/167)) ([189bdf5](https://github.com/usearazzo/arazzo-toolkit/commit/189bdf512ed74f6bc80e3fc4dc1f2b83049688e8)), closes [#158](https://github.com/usearazzo/arazzo-toolkit/issues/158)

### Features

- release @usearazzo/resolver ([#171](https://github.com/usearazzo/arazzo-toolkit/issues/171)) ([7fe7597](https://github.com/usearazzo/arazzo-toolkit/commit/7fe759757436416562c47d1d7f7dd6b26d945b05))
- **resolver:** add resolve and bundle and publish the package ([#157](https://github.com/usearazzo/arazzo-toolkit/issues/157)) ([eb84108](https://github.com/usearazzo/arazzo-toolkit/commit/eb8410866bac5569a86eebeda863d9a1feed6c87))

## [1.0.1-alpha.2](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.1...v1.0.1-alpha.2) (2026-09-08)

### Bug Fixes

- **parser:** resolve relative file paths against working directory ([#148](https://github.com/usearazzo/arazzo-toolkit/issues/148)) ([41b5b22](https://github.com/usearazzo/arazzo-toolkit/commit/41b5b22ff1940b13b5c6419ac8787c1d722483b2)), closes [#147](https://github.com/usearazzo/arazzo-toolkit/issues/147)

## 1.0.1-alpha.1 (2026-09-08)

- refactor(validator)!: remove CLI layer and fix URI resolution (#11) ([76f8556](https://github.com/usearazzo/arazzo-toolkit/commit/76f8556bbece403c38dc8f68e020ab359fee563c)), closes [#11](https://github.com/usearazzo/arazzo-toolkit/issues/11)

### Bug Fixes

- **parser:** distinguish shared source descriptions from cycles ([#142](https://github.com/usearazzo/arazzo-toolkit/issues/142)) ([8c5bc7d](https://github.com/usearazzo/arazzo-toolkit/commit/8c5bc7d82181f90a11a4168bfd4ce8070c007439)), closes [#139](https://github.com/usearazzo/arazzo-toolkit/issues/139)
- **parser:** make README shorter and more appealing ([0f650c1](https://github.com/usearazzo/arazzo-toolkit/commit/0f650c1c906372492cf313d40ab7eec2a1c379ab))
- **parser:** scope MemoryResolver to the exact URI it serves ([#136](https://github.com/usearazzo/arazzo-toolkit/issues/136)) ([3bbf8e1](https://github.com/usearazzo/arazzo-toolkit/commit/3bbf8e1919890828fff286d77a6b2e5186b84b15)), closes [#135](https://github.com/usearazzo/arazzo-toolkit/issues/135)
- **runner:** attribute a thrown ResolverError to the step or workflow it came from ([#57](https://github.com/usearazzo/arazzo-toolkit/issues/57)) ([faa66b4](https://github.com/usearazzo/arazzo-toolkit/commit/faa66b44ba54956f92b0ec7a6ae468915a925c72)), closes [#55](https://github.com/usearazzo/arazzo-toolkit/issues/55)
- **runner:** deliver step parameters by their (name, in) identity ([#42](https://github.com/usearazzo/arazzo-toolkit/issues/42)) ([c45d5d2](https://github.com/usearazzo/arazzo-toolkit/commit/c45d5d29798c585ec816b5c8eac8b4bd8dc31c70)), closes [#41](https://github.com/usearazzo/arazzo-toolkit/issues/41)
- **runner:** guard a scalar requestBody from silently sending no body ([#56](https://github.com/usearazzo/arazzo-toolkit/issues/56)) ([8bcae12](https://github.com/usearazzo/arazzo-toolkit/commit/8bcae129c75b5e4ee3e4769c3d442efa2ff3116a)), closes [#51](https://github.com/usearazzo/arazzo-toolkit/issues/51) [#52](https://github.com/usearazzo/arazzo-toolkit/issues/52)
- **runner:** report a malformed list as a typed error ([#51](https://github.com/usearazzo/arazzo-toolkit/issues/51)) ([91bb622](https://github.com/usearazzo/arazzo-toolkit/commit/91bb622fac5c7ad8bcb5c2909f74c4b461467b1f)), closes [#50](https://github.com/usearazzo/arazzo-toolkit/issues/50)
- **runner:** throw on a malformed onSuccess/onFailure or criteria entry ([#59](https://github.com/usearazzo/arazzo-toolkit/issues/59)) ([0e6999b](https://github.com/usearazzo/arazzo-toolkit/commit/0e6999b06cdd6138da92a812b0441231a49769c4)), closes [#criteriaMet](https://github.com/usearazzo/arazzo-toolkit/issues/criteriaMet) [#51](https://github.com/usearazzo/arazzo-toolkit/issues/51) [#54](https://github.com/usearazzo/arazzo-toolkit/issues/54)
- **runner:** validate workflow outputs shape before running prerequisites or steps ([#53](https://github.com/usearazzo/arazzo-toolkit/issues/53)) ([#61](https://github.com/usearazzo/arazzo-toolkit/issues/61)) ([5d97188](https://github.com/usearazzo/arazzo-toolkit/commit/5d971888e626188a6fe15512c89adc900b69d9ac))

### Features

- **parser:** add runtime expression and criterion condition parsing ([#130](https://github.com/usearazzo/arazzo-toolkit/issues/130)) ([9f1a239](https://github.com/usearazzo/arazzo-toolkit/commit/9f1a239de4dd74d55795a5142525860142429eaf)), closes [#99](https://github.com/usearazzo/arazzo-toolkit/issues/99)
- **parser:** export ParseError from package entry point ([#141](https://github.com/usearazzo/arazzo-toolkit/issues/141)) ([177fb0f](https://github.com/usearazzo/arazzo-toolkit/commit/177fb0f143600a7ae2edd5349e27c2c292945d54)), closes [#140](https://github.com/usearazzo/arazzo-toolkit/issues/140)
- **parser:** honor resolve.baseURI for object and inline input ([#138](https://github.com/usearazzo/arazzo-toolkit/issues/138)) ([4dcd5d6](https://github.com/usearazzo/arazzo-toolkit/commit/4dcd5d6512f4b099e2ec3321d2b72948372ae55e)), closes [#137](https://github.com/usearazzo/arazzo-toolkit/issues/137)
- **runner:** cancel a run through an AbortSignal ([#38](https://github.com/usearazzo/arazzo-toolkit/issues/38)) ([f0c06e7](https://github.com/usearazzo/arazzo-toolkit/commit/f0c06e73900a7c820ed55efb0edea54ec0509c58)), closes [#28](https://github.com/usearazzo/arazzo-toolkit/issues/28)
- **runner:** execute a retry action's stepId/workflowId reference before each retry attempt ([#63](https://github.com/usearazzo/arazzo-toolkit/issues/63)) ([e52aee5](https://github.com/usearazzo/arazzo-toolkit/commit/e52aee5b4a7eb08db44ba6f483da9b8a4545e015)), closes [#run](https://github.com/usearazzo/arazzo-toolkit/issues/run) [#62](https://github.com/usearazzo/arazzo-toolkit/issues/62) [#chargedAttempt](https://github.com/usearazzo/arazzo-toolkit/issues/chargedAttempt) [#62](https://github.com/usearazzo/arazzo-toolkit/issues/62)
- **runner:** inherit workflow-level parameters into steps ([#40](https://github.com/usearazzo/arazzo-toolkit/issues/40)) ([c63674e](https://github.com/usearazzo/arazzo-toolkit/commit/c63674e3f7da7773889d6b911d23a432f92127b1)), closes [#39](https://github.com/usearazzo/arazzo-toolkit/issues/39)
- **runner:** resolve workflow step references in runtime expressions ([#105](https://github.com/usearazzo/arazzo-toolkit/issues/105)) ([2d666fa](https://github.com/usearazzo/arazzo-toolkit/commit/2d666faf2b7e9b1dd06da0ffe0263013a086322c)), closes [#104](https://github.com/usearazzo/arazzo-toolkit/issues/104)
- **runner:** run sub-workflow steps and dependsOn workflows ([#37](https://github.com/usearazzo/arazzo-toolkit/issues/37)) ([940ca9c](https://github.com/usearazzo/arazzo-toolkit/commit/940ca9cd30faea1e296956974182b45fa479c90e))
- **runner:** support cross-document workflowId references ([#73](https://github.com/usearazzo/arazzo-toolkit/issues/73)) ([562cafb](https://github.com/usearazzo/arazzo-toolkit/commit/562cafb47801abb2274df258d5ecf3055c5caa5d)), closes [uri#id](https://github.com/uri/issues/id) [#64](https://github.com/usearazzo/arazzo-toolkit/issues/64)
- **runner:** support step-level goto to a workflowId as a one-way transfer ([#66](https://github.com/usearazzo/arazzo-toolkit/issues/66)) ([21d5b24](https://github.com/usearazzo/arazzo-toolkit/commit/21d5b24b2484d5c6976eaa2c46e650f177149931))

### BREAKING CHANGES

- the arazzo-validator binary is no longer published.
  Use the programmatic API (validateURI/validate) instead.
