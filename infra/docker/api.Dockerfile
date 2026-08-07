FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci
RUN npm run build --workspace @tu-hau/contracts && npm run build --workspace @tu-hau/api

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/demucs
ENV PATH="/opt/demucs/bin:${PATH}"
RUN pip install --no-cache-dir \
      "https://download.pytorch.org/whl/cpu/torch-2.7.1%2Bcpu-cp311-cp311-manylinux_2_28_x86_64.whl" \
      "https://download.pytorch.org/whl/cpu/torchaudio-2.7.1%2Bcpu-cp311-cp311-manylinux_2_28_x86_64.whl" \
  && python3 -c "import torch, torchaudio; assert torch.__version__ == '2.7.1+cpu'; assert torchaudio.__version__ == '2.7.1+cpu'" \
  && pip install --no-cache-dir demucs==4.0.1 \
  && python3 -c "import torch, torchaudio; assert torch.__version__ == '2.7.1+cpu'; assert torchaudio.__version__ == '2.7.1+cpu'"
RUN python3 -c "from demucs.pretrained import get_model; get_model('htdemucs_ft')"
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
CMD ["node", "apps/api/dist/main.js"]
