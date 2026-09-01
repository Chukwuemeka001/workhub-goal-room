ARG TOOLCHAIN_IMAGE
FROM ${TOOLCHAIN_IMAGE} AS toolchain
FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS nodebase
FROM scratch
COPY --from=nodebase / /
COPY --from=toolchain /verifier/node_modules /verifier/node_modules
COPY scripts/aca-sandbox/runner.mjs /verifier/runner.mjs
COPY scripts/aca-controller/snapshot.mjs /aca-controller/snapshot.mjs
COPY scripts/aca-sandbox/vitest.config.mjs /verifier/vitest.config.mjs
COPY scripts/aca-sandbox/vite.config.mjs /verifier/vite.config.mjs
COPY scripts/aca-sandbox/tsconfig.json /verifier/tsconfig.json
RUN mkdir -p /sealed /work /output /tmp && chown -R 65532:65532 /sealed /work /output /tmp && chmod 0555 /sealed /verifier
ENV HOME=/nonexistent PATH=/usr/local/bin:/usr/bin:/bin CI=1 LANG=C.UTF-8 LC_ALL=C.UTF-8
USER 65532:65532
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/node","/verifier/runner.mjs"]
