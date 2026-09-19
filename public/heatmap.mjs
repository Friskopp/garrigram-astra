const DAY = 86400000;

export function mapPosts(posts, period = 'all', now = Date.now()) {
  const days = { day: 1, week: 7, month: 30 }[period];
  return posts.filter(post => {
    if (!Number.isFinite(post.lat) || !Number.isFinite(post.lng) || Math.abs(post.lat) > 90 || Math.abs(post.lng) > 180) return false;
    if (!days) return true;
    const time = Date.parse(post.created_at);
    return time >= now - days * DAY && time <= now;
  });
}

// Add each photo's smooth footprint. Fixed scale keeps time periods comparable:
// ten overlapping photos are hot even if the rest of the map is empty.
export function densityField(points, width, height, radius = 16) {
  const values = new Float32Array(width * height);
  for (const [x, y] of points) {
    for (let row = Math.max(0, Math.ceil(y - radius)); row < Math.min(height, y + radius); row++) {
      for (let col = Math.max(0, Math.ceil(x - radius)); col < Math.min(width, x + radius); col++) {
        const distance = ((col - x) ** 2 + (row - y) ** 2) / radius ** 2;
        if (distance < 1) values[row * width + col] += (1 - distance) ** 2;
      }
    }
  }
  return values;
}

export function createHeatLayer(L) {
  return new (L.Layer.extend({
    onAdd(map) {
      this.map = map;
      this.canvas = L.DomUtil.create('canvas', 'photo-heatmap leaflet-zoom-hide');
      this.canvas.setAttribute('aria-hidden', 'true');
      map.getPanes().overlayPane.append(this.canvas);
      this.draw();
    },
    onRemove() { this.canvas.remove(); this.map = null; },
    getEvents() { return { moveend: this.draw, resize: this.draw }; },
    setPosts(posts) { this.posts = posts; if (this.map) this.draw(); return this; },
    draw() {
      if (!this.map) return;
      const size = this.map.getSize();
      if (!size.x || !size.y) return;
      // Render at one third resolution, then let canvas interpolation smooth it.
      const scale = 3, width = Math.ceil(size.x / scale), height = Math.ceil(size.y / scale);
      const canvas = this.canvas;
      canvas.width = width; canvas.height = height;
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
      L.DomUtil.setPosition(canvas, this.map.containerPointToLayerPoint([0, 0]));
      const center = this.map.getCenter().lng;
      const points = (this.posts || []).map(post => {
        // Choose the world copy nearest the viewport, including across the dateline.
        const lng = post.lng + 360 * Math.round((center - post.lng) / 360);
        const point = this.map.latLngToContainerPoint([post.lat, lng]);
        return [point.x / scale, point.y / scale];
      });
      const values = densityField(points, width, height);
      const context = canvas.getContext('2d'), pixels = context.createImageData(width, height);
      const stops = [[163, 248, 210], [237, 160, 70], [244, 70, 43]];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value < .01) continue;
        const level = Math.min(1, Math.max(0, (value - 1) / 9)) * 2;
        const segment = Math.min(1, Math.floor(level)), blend = level - segment;
        for (let channel = 0; channel < 3; channel++) pixels.data[i * 4 + channel] = stops[segment][channel] * (1 - blend) + stops[segment + 1][channel] * blend;
        pixels.data[i * 4 + 3] = Math.min(.85, value * .65) * 255;
      }
      context.putImageData(pixels, 0, 0);
    }
  }))();
}
