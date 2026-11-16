'use client';

import { useEffect, useRef } from 'react';

/** Cities (lat, lon) joined to Bengaluru by signing arcs. */
const HUB: [number, number] = [12.97, 77.59];
const CITIES: [number, number][] = [
  [19.08, 72.88], // Mumbai
  [28.61, 77.21], // Delhi
  [51.51, -0.13], // London
  [40.71, -74.01], // New York
  [50.11, 8.68], // Frankfurt
  [1.35, 103.82], // Singapore
  [25.2, 55.27], // Dubai
  [-33.87, 151.21], // Sydney
];

const rad = (d: number) => (d * Math.PI) / 180;
const toVec = ([lat, lon]: [number, number]): [number, number, number] => [Math.cos(rad(lat)) * Math.sin(rad(lon)), Math.sin(rad(lat)), Math.cos(rad(lat)) * Math.cos(rad(lon))];

/** Points along the great circle from a to b, lifted off the surface towards the middle. */
function arc(a: [number, number, number], b: [number, number, number], steps = 48) {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const omega = Math.acos(dot);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const s = Math.sin(omega) || 1;
    const k1 = Math.sin((1 - t) * omega) / s;
    const k2 = Math.sin(t * omega) / s;
    const lift = 1 + Math.sin(Math.PI * t) * Math.min(0.06 * omega, 0.12);
    return [(a[0] * k1 + b[0] * k2) * lift, (a[1] * k1 + b[1] * k2) * lift, (a[2] * k1 + b[2] * k2) * lift] as [number, number, number];
  });
}

/** A rotating dotted globe with glowing arcs between cities, drawn on a canvas. */
export function Globe({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Evenly spread dots (Fibonacci sphere)
    const N = 1500;
    const dots = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const t = i * Math.PI * (3 - Math.sqrt(5));
      return [Math.cos(t) * r, y, Math.sin(t) * r] as [number, number, number];
    });
    const hub = toVec(HUB);
    const arcs = CITIES.map((c) => arc(hub, toVec(c)));
    const ends = [hub, ...CITIES.map(toVec)];

    let raf = 0;
    let visible = true;
    let size = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size = canvas.clientWidth;
      canvas.width = canvas.height = size * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(canvas);

    // Start with India facing the viewer
    let angle = -rad(HUB[1]) + 0.35;
    const tilt = rad(-14);
    const project = ([x, y, z]: [number, number, number]) => {
      const cx = x * Math.cos(angle) + z * Math.sin(angle);
      const cz = -x * Math.sin(angle) + z * Math.cos(angle);
      const ty = y * Math.cos(tilt) - cz * Math.sin(tilt);
      const tz = y * Math.sin(tilt) + cz * Math.cos(tilt);
      const R = size * 0.42;
      return { x: size / 2 + cx * R, y: size / 2 - ty * R, z: tz };
    };

    const draw = (time: number) => {
      ctx.clearRect(0, 0, size, size);
      // Glow behind the globe
      const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.2, size / 2, size / 2, size * 0.5);
      g.addColorStop(0, 'rgba(109,76,255,0.28)');
      g.addColorStop(1, 'rgba(109,76,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      for (const d of dots) {
        const p = project(d);
        ctx.fillStyle = p.z > 0 ? `rgba(190,180,255,${0.35 + p.z * 0.55})` : 'rgba(150,140,230,0.08)';
        ctx.fillRect(p.x, p.y, 1.6, 1.6);
      }
      arcs.forEach((pts, n) => {
        const proj = pts.map(project);
        ctx.beginPath();
        proj.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        const front = proj[Math.floor(proj.length / 2)].z > -0.1;
        ctx.strokeStyle = front ? 'rgba(232,193,112,0.55)' : 'rgba(232,193,112,0.08)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // A pulse travelling along each arc
        const t = ((time / 2600 + n / arcs.length) % 1) * (proj.length - 1);
        const p = proj[Math.floor(t)];
        if (front && p.z > -0.2) {
          ctx.fillStyle = 'rgba(255,236,190,0.95)';
          ctx.shadowColor = '#e8c170';
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      });
      for (const e of ends) {
        const p = project(e);
        if (p.z <= 0) continue;
        ctx.fillStyle = 'rgba(255,240,205,0.95)';
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    const loop = (time: number) => {
      if (visible) {
        angle += 0.0018;
        draw(time);
      }
      raf = requestAnimationFrame(loop);
    };
    if (still) draw(0);
    else raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return <canvas ref={ref} className={className} style={{ aspectRatio: '1 / 1', width: '100%' }} aria-label="Globe showing agreements signed between cities" role="img" />;
}
