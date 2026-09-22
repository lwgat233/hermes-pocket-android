FROM $BASE_LOCAL
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \\
      libnss3 libx11-6 libx11-xcb1 libxcb1 libxcb-glx0 libxcb-xfixes0 libxcb-shm0 \\
      libgl1 libglu1-mesa libgbm1 libdrm2 libpulse0 libasound2 libxdamage1 \\
      libxcomposite1 libxrandr2 libxcursor1 libxi6 libxtst6 libxkbcommon0 \\
      libstdc++6 libxml2 zlib1g ca-certificates curl procps \\
    && rm -rf /var/lib/apt/lists/*
