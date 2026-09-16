const fs = require('fs');
const path = require('path');

// Generate true raster PNG bytes using Node Buffer without external dependencies
// We can write a clean HTML page that renders the SVG into Canvas and writes PNGs directly
const html = `<!DOCTYPE html>
<html>
<body>
<canvas id="c16" width="16" height="16"></canvas>
<canvas id="c48" width="48" height="48"></canvas>
<canvas id="c128" width="128" height="128"></canvas>
<script>
  const svgText = \`${fs.readFileSync(path.join(__dirname, 'icon.svg'), 'utf8')}\`;
  const blob = new Blob([svgText], {type: 'image/svg+xml'});
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    [16, 48, 128].forEach(size => {
      const c = document.getElementById('c' + size);
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const a = document.createElement('a');
      a.download = 'icon-' + size + '.png';
      a.href = c.toDataURL('image/png');
      a.click();
    });
  };
  img.src = url;
</script>
</body>
</html>`;

fs.writeFileSync(path.join(__dirname, 'render_icons.html'), html);
console.log('HTML helper created.');