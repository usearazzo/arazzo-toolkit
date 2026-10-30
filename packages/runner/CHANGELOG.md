# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [1.0.1-alpha.18](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.17...v1.0.1-alpha.18) (2026-10-30)

### Bug Fixes

- **runner:** wrap document load failures in DocumentLoadError ([#296](https://github.com/usearazzo/arazzo-toolkit/issues/296)) ([ad2307d](https://github.com/usearazzo/arazzo-toolkit/commit/ad2307debcebf05006f1b925fddeca9f138912ea)), closes [#272](https://github.com/usearazzo/arazzo-toolkit/issues/272)

## [1.0.1-alpha.17](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.16...v1.0.1-alpha.17) (2026-10-29)

### Bug Fixes

- **runner:** reject a querystring name shaped like a location key ([#292](https://github.com/usearazzo/arazzo-toolkit/issues/292)) ([de44f5e](https://github.com/usearazzo/arazzo-toolkit/commit/de44f5e4c65b225cb3c6caad9887d5b51fcd02b8)), closes [#280](https://github.com/usearazzo/arazzo-toolkit/issues/280)

## [1.0.1-alpha.16](https://github.com/usearazzo/arazzo-toolkit/compare/v1.0.1-alpha.15...v1.0.1-alpha.16) (2026-10-28)

### Bug Fixes

- **runner:** merge workflow default actions into steps by name ([#288](https://github.com/usearazzo/arazzo-toolkit/issues/288)) ([8ee0ba3](https://github.com/usearazzo/arazzo-toolkit/commit/8ee0ba387c475fef329c7d094e10ed3b2b0753c1)), closes [#117](https://github.com/usearazzo/arazzo-toolkit/issues/117)

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

### Features

- **runner:** export SourceDescriptionsLocatorNormalizer ([9387076](https://github.com/usearazzo/arazzo-toolkit/commit/9387076238df3f89767a8b65c92e5d59443e351d))
- **runner:** run petstore workflows e2e and publish the runner ([#233](https://github.com/usearazzo/arazzo-toolkit/issues/233)) ([aaf9cbc](https://github.com/usearazzo/arazzo-toolkit/commit/aaf9cbc50f328a99b32665fdfff6755588a20260)), closes [#79](https://github.com/usearazzo/arazzo-toolkit/issues/79)
- **runner:** treat a called workflow as its step's result ([#230](https://github.com/usearazzo/arazzo-toolkit/issues/230)) ([05d996b](https://github.com/usearazzo/arazzo-toolkit/commit/05d996b54505f33b7e652e2bc4e2ebb4d2f7e600)), closes [#228](https://github.com/usearazzo/arazzo-toolkit/issues/228)
