// ============================================================
// CURLING GAME - Complete Game Logic
// ============================================================

(function () {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================
    const ICE_FRICTION = 0.984;          // per-frame velocity multiplier (slightly less friction)
    const SWEPT_FRICTION = 0.998;        // friction on swept ice (very effective sweeping)
    const ROUGH_FRICTION = 0.96;         // friction on rough ice patches (much harder)
    const MIN_VELOCITY = 0.06;           // below this → stone is stopped
    const STONE_RADIUS = 14;
    const STONE_MASS = 1;
    const RESTITUTION = 0.85;            // collision elasticity
    const MAX_LAUNCH_SPEED = 10;         // slightly more inertia for longer turns
    const CANVAS_PADDING = 30;
    const SWEEP_RADIUS = 30;             // larger sweep area per brush stroke
    const SWEEP_FADE_TIME = 5000;        // ms before swept zones start fading
    const FRICTION_DEGRADATION = 0.001;  // friction increase per end (ice degrades)
    const MAX_SWEEP_ENERGY = 100;        // max sweep energy per turn
    const SWEEP_DRAIN_RATE = 1.5;        // energy drained per frame while sweeping
    const AIM_WOBBLE_AMOUNT = 0.02;      // radians of aim wobble
    const AIM_WOBBLE_SPEED = 3;          // speed of wobble oscillation
    const AIM_TIME_LIMIT = 15000;        // ms to aim before auto-skip (15s)
    const FGZ_STONE_COUNT = 4;           // first N stones protected by free guard zone

    // Sheet dimensions (in game units, scaled to canvas)
    const SHEET = {
        width: 240,
        length: 900,
        houseRadius: 90,
        buttonRadius: 8,
        innerRing: 30,
        middleRing: 60,
        hogLineFromEnd: 200,
        hackFromEnd: 30,
        houseCenterY: 120,  // distance from top of sheet to center of house
        centerLineY: 450    // middle line — stones must reach this to stay active
    };

    // ============================================================
    // UTILITY
    // ============================================================
    function dist(a, b) {
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function clamp(val, min, max) {
        return Math.max(min, Math.min(max, val));
    }

    // ============================================================
    // STONE
    // ============================================================
    class Stone {
        constructor(team, x, y) {
            this.team = team; // 0 = red, 1 = yellow
            this.x = x;
            this.y = y;
            this.vx = 0;
            this.vy = 0;
            this.radius = STONE_RADIUS;
            this.active = true;
        }

        get speed() {
            return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        }

        get isMoving() {
            return this.speed > MIN_VELOCITY;
        }

        update(sweepZones, roughZones, currentEnd) {
            if (!this.active) return;
            this.x += this.vx;
            this.y += this.vy;

            // Base friction degrades each end (ice gets worse)
            let baseFriction = ICE_FRICTION - (currentEnd - 1) * FRICTION_DEGRADATION;
            let friction = baseFriction;

            // Check rough ice zones (higher friction)
            if (roughZones && roughZones.length > 0) {
                for (const zone of roughZones) {
                    const dx = this.x - zone.x;
                    const dy = this.y - zone.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < zone.radius + this.radius * 0.5) {
                        friction = ROUGH_FRICTION;
                        break;
                    }
                }
            }

            // Check swept zones (lower friction — overrides rough)
            if (sweepZones && sweepZones.length > 0) {
                for (const zone of sweepZones) {
                    const dx = this.x - zone.x;
                    const dy = this.y - zone.y;
                    const d = Math.sqrt(dx * dx + dy * dy);
                    if (d < zone.radius + this.radius * 0.5) {
                        friction = SWEPT_FRICTION;
                        break;
                    }
                }
            }

            // Apply friction
            this.vx *= friction;
            this.vy *= friction;

            // Stop if very slow
            if (this.speed < MIN_VELOCITY) {
                this.vx = 0;
                this.vy = 0;
            }
        }
    }

    // ============================================================
    // PHYSICS ENGINE
    // ============================================================
    class PhysicsEngine {
        constructor() {
            this.stones = [];
            this.sweepZones = [];  // { x, y, radius, time }
            this.roughZones = [];  // { x, y, radius }
        }

        addStone(stone) {
            this.stones.push(stone);
        }

        addSweepZone(x, y) {
            // Avoid adding too many overlapping zones
            const existing = this.sweepZones.find(z => {
                const dx = z.x - x;
                const dy = z.y - y;
                return Math.sqrt(dx * dx + dy * dy) < SWEEP_RADIUS * 0.5;
            });
            if (!existing) {
                this.sweepZones.push({ x, y, radius: SWEEP_RADIUS, time: Date.now() });
            }
        }

        clearSweepZones() {
            this.sweepZones = [];
        }

        update(bounds, currentEnd) {
            // Move stones with zone awareness and ice degradation
            for (const s of this.stones) {
                s.update(this.sweepZones, this.roughZones, currentEnd || 1);
            }

            // Stone-to-stone collisions (skip inactive stones)
            for (let i = 0; i < this.stones.length; i++) {
                if (!this.stones[i].active) continue;
                for (let j = i + 1; j < this.stones.length; j++) {
                    if (!this.stones[j].active) continue;
                    this.resolveCollision(this.stones[i], this.stones[j]);
                }
            }

            // Mark out-of-bounds stones as inactive (keep in array for visibility)
            for (const s of this.stones) {
                if (!s.active) continue;
                if (s.x - s.radius < bounds.left - 20 || s.x + s.radius > bounds.right + 20) {
                    s.active = false;
                    s.vx = 0;
                    s.vy = 0;
                }
                if (s.y - s.radius < bounds.top - 40 || s.y + s.radius > bounds.bottom + 40) {
                    s.active = false;
                    s.vx = 0;
                    s.vy = 0;
                }
            }
        }

        resolveCollision(a, b) {
            if (!a.active || !b.active) return;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            const minDist = a.radius + b.radius;

            if (d < minDist && d > 0) {
                // Normalize
                const nx = dx / d;
                const ny = dy / d;

                // Relative velocity
                const dvx = a.vx - b.vx;
                const dvy = a.vy - b.vy;
                const dvDotN = dvx * nx + dvy * ny;

                // Don't resolve if moving apart
                if (dvDotN <= 0) return;

                // Impulse (equal mass)
                const impulse = dvDotN * RESTITUTION;

                a.vx -= impulse * nx;
                a.vy -= impulse * ny;
                b.vx += impulse * nx;
                b.vy += impulse * ny;

                // Separate overlapping stones
                const overlap = minDist - d;
                a.x -= overlap * 0.5 * nx;
                a.y -= overlap * 0.5 * ny;
                b.x += overlap * 0.5 * nx;
                b.y += overlap * 0.5 * ny;
            }
        }

        get anyMoving() {
            return this.stones.some(s => s.isMoving);
        }

        clearAll() {
            this.stones = [];
            this.sweepZones = [];
        }

        generateRoughZones() {
            this.roughZones = [];
            const count = 3 + Math.floor(Math.random() * 3); // 3-5 patches
            for (let i = 0; i < count; i++) {
                this.roughZones.push({
                    x: 30 + Math.random() * (SHEET.width - 60),
                    y: SHEET.houseCenterY + 40 + Math.random() * (SHEET.length - SHEET.houseCenterY - SHEET.hackFromEnd - 120),
                    radius: 10 + Math.random() * 10
                });
            }
        }
    }

    // ============================================================
    // RENDERER
    // ============================================================
    class Renderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.scale = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this.resize();
        }

        resize() {
            const header = document.querySelector('.game-header');
            const headerH = header ? header.offsetHeight : 60;
            // Adjust margins for mobile vs desktop
            const isMobile = window.innerWidth <= 768;
            // Mobile: Side panel on left (width ~90px), so add hMargin
            const hMargin = isMobile ? 100 : 80;
            // Mobile: Reset vMargin to normal since panel is on side now (safe area handled by CSS)
            const vMargin = isMobile ? 30 : 20;

            const availW = window.innerWidth - hMargin;
            const availH = window.innerHeight - headerH - vMargin;

            // Scale sheet to fit
            const padding = isMobile ? 5 : CANVAS_PADDING;
            const scaleW = availW / (SHEET.width + padding * 2);
            const scaleH = availH / (SHEET.length + padding * 2);
            this.scale = Math.min(scaleW, scaleH);

            this.canvas.width = (SHEET.width + padding * 2) * this.scale;
            this.canvas.height = (SHEET.length + padding * 2) * this.scale;

            this.offsetX = padding * this.scale;
            this.offsetY = padding * this.scale;
        }

        sx(x) { return this.offsetX + x * this.scale; }
        sy(y) { return this.offsetY + y * this.scale; }
        ss(v) { return v * this.scale; }

        // Convert canvas pixel coords to game coords
        toGame(px, py) {
            return {
                x: (px - this.offsetX) / this.scale,
                y: (py - this.offsetY) / this.scale
            };
        }

        drawSheet() {
            const ctx = this.ctx;
            const w = SHEET.width;
            const h = SHEET.length;

            // Clear
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

            // Ice surface
            const iceGrad = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
            iceGrad.addColorStop(0, '#d6eef8');
            iceGrad.addColorStop(0.5, '#e8f4f8');
            iceGrad.addColorStop(1, '#d0e8f0');
            ctx.fillStyle = iceGrad;
            ctx.fillRect(this.sx(0), this.sy(0), this.ss(w), this.ss(h));

            // Ice texture (pebble dots are drawn separately via pebbleSeed in render loop)

            // Sheet border
            ctx.strokeStyle = '#93c5fd';
            ctx.lineWidth = this.ss(2);
            ctx.strokeRect(this.sx(0), this.sy(0), this.ss(w), this.ss(h));

            // Center line
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
            ctx.lineWidth = this.ss(1);
            ctx.setLineDash([this.ss(8), this.ss(8)]);
            ctx.beginPath();
            ctx.moveTo(this.sx(w / 2), this.sy(0));
            ctx.lineTo(this.sx(w / 2), this.sy(h));
            ctx.stroke();
            ctx.setLineDash([]);

            // Tee line (through house center)
            ctx.strokeStyle = 'rgba(59, 130, 246, 0.4)';
            ctx.lineWidth = this.ss(1.5);
            ctx.beginPath();
            ctx.moveTo(this.sx(0), this.sy(SHEET.houseCenterY));
            ctx.lineTo(this.sx(w), this.sy(SHEET.houseCenterY));
            ctx.stroke();

            // Back line (behind house)
            ctx.beginPath();
            ctx.moveTo(this.sx(0), this.sy(SHEET.houseCenterY - SHEET.houseRadius - 10));
            ctx.lineTo(this.sx(w), this.sy(SHEET.houseCenterY - SHEET.houseRadius - 10));
            ctx.stroke();

            // Hog line
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = this.ss(2.5);
            ctx.beginPath();
            ctx.moveTo(this.sx(0), this.sy(SHEET.hogLineFromEnd));
            ctx.lineTo(this.sx(w), this.sy(SHEET.hogLineFromEnd));
            ctx.stroke();

            // Hog line label
            ctx.fillStyle = '#ef4444';
            ctx.font = `${this.ss(9)}px Inter, sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText('HOG LINE', this.sx(6), this.sy(SHEET.hogLineFromEnd) - this.ss(5));

            // Center line (must-reach line)
            ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
            ctx.lineWidth = this.ss(2);
            ctx.setLineDash([this.ss(10), this.ss(6)]);
            ctx.beginPath();
            ctx.moveTo(this.sx(0), this.sy(SHEET.centerLineY));
            ctx.lineTo(this.sx(w), this.sy(SHEET.centerLineY));
            ctx.stroke();
            ctx.setLineDash([]);

            // Center line label
            ctx.fillStyle = 'rgba(234, 179, 8, 0.7)';
            ctx.font = `${this.ss(8)}px Inter, sans-serif`;
            ctx.textAlign = 'left';
            ctx.fillText('LINHA CENTRAL', this.sx(6), this.sy(SHEET.centerLineY) - this.ss(5));

            // House (concentric rings) - drawn from largest to smallest
            const houseX = w / 2;
            const houseY = SHEET.houseCenterY;

            // Outer ring (blue)
            this.drawRing(houseX, houseY, SHEET.houseRadius, '#3b82f6', 'rgba(59, 130, 246, 0.15)');
            // Middle ring (white)
            this.drawRing(houseX, houseY, SHEET.middleRing, '#f1f5f9', 'rgba(255, 255, 255, 0.5)');
            // Inner ring (red)
            this.drawRing(houseX, houseY, SHEET.innerRing, '#ef4444', 'rgba(239, 68, 68, 0.2)');
            // Button (center)
            this.drawRing(houseX, houseY, SHEET.buttonRadius, '#1e3a5f', '#1e3a5f');

            // Score zone labels around rings
            const zones = [
                { radius: SHEET.houseRadius, label: '1', color: 'rgba(59, 130, 246, 0.9)' },
                { radius: SHEET.middleRing, label: '2', color: 'rgba(100, 116, 139, 0.9)' },
                { radius: SHEET.innerRing, label: '3', color: 'rgba(239, 68, 68, 0.9)' },
                { radius: SHEET.buttonRadius + 4, label: '4', color: 'rgba(255, 255, 255, 0.95)' }
            ];

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (const z of zones) {
                const lx = houseX + z.radius * 0.7;
                const ly = houseY - z.radius * 0.7;
                const fs = this.ss(z.radius < 15 ? 7 : 9);
                const pr = this.ss(z.radius < 15 ? 5 : 6);

                // Background pill
                ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                ctx.beginPath();
                ctx.arc(this.sx(lx), this.sy(ly), pr, 0, Math.PI * 2);
                ctx.fill();

                // Number
                ctx.fillStyle = z.color;
                ctx.font = `bold ${fs}px Inter, sans-serif`;
                ctx.fillText(z.label, this.sx(lx), this.sy(ly));
            }

            // Hack (starting position)
            const hackY = h - SHEET.hackFromEnd;
            ctx.fillStyle = '#475569';
            ctx.fillRect(this.sx(w / 2 - 12), this.sy(hackY - 3), this.ss(24), this.ss(6));
            ctx.fillStyle = '#334155';
            ctx.fillRect(this.sx(w / 2 - 4), this.sy(hackY - 6), this.ss(8), this.ss(12));

            // Hack label
            ctx.fillStyle = '#64748b';
            ctx.font = `${this.ss(9)}px Inter, sans-serif`;
            ctx.textAlign = 'center';
            ctx.fillText('HACK', this.sx(w / 2), this.sy(hackY + 16));
        }

        drawRing(x, y, radius, strokeColor, fillColor) {
            const ctx = this.ctx;
            ctx.beginPath();
            ctx.arc(this.sx(x), this.sy(y), this.ss(radius), 0, Math.PI * 2);
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = this.ss(2);
            ctx.stroke();
        }

        drawStone(stone, flag) {
            const isGhost = !stone.active;
            const ctx = this.ctx;
            const x = this.sx(stone.x);
            const y = this.sy(stone.y);
            const r = this.ss(stone.radius);

            // Apply ghost effect for inactive stones
            if (isGhost) {
                ctx.save();
                ctx.globalAlpha = 0.3;
            }

            // Shadow
            ctx.beginPath();
            ctx.arc(x + this.ss(2), y + this.ss(3), r, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fill();

            // Stone body - subtle team tint
            const stoneGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
            if (stone.team === 0) {
                stoneGrad.addColorStop(0, '#fca5a5');
                stoneGrad.addColorStop(0.6, '#ef4444');
                stoneGrad.addColorStop(1, '#b91c1c');
            } else {
                stoneGrad.addColorStop(0, '#fde68a');
                stoneGrad.addColorStop(0.6, '#eab308');
                stoneGrad.addColorStop(1, '#a16207');
            }

            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fillStyle = stoneGrad;
            ctx.fill();

            // Stone border
            ctx.strokeStyle = stone.team === 0 ? '#991b1b' : '#854d0e';
            ctx.lineWidth = this.ss(1.5);
            ctx.stroke();

            // Flag emoji on stone
            if (flag) {
                ctx.font = `${r * 1.1}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(flag, x, y + r * 0.08);
            } else {
                // Fallback: handle highlight ring if no flag
                ctx.beginPath();
                ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
                ctx.strokeStyle = stone.team === 0 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.5)';
                ctx.lineWidth = this.ss(1.5);
                ctx.stroke();
            }

            // Shine
            ctx.beginPath();
            ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.18, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.4)';
            ctx.fill();

            if (isGhost) {
                ctx.restore();
            }
        }

        drawAimLine(from, to, power) {
            const ctx = this.ctx;
            const fx = this.sx(from.x);
            const fy = this.sy(from.y);
            const tx = this.sx(to.x);
            const ty = this.sy(to.y);

            // Glow behind the line for contrast
            ctx.setLineDash([this.ss(6), this.ss(4)]);
            ctx.strokeStyle = `rgba(255, 140, 0, ${0.4 + power * 0.4})`;
            ctx.lineWidth = this.ss(5);
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.stroke();

            // Main direction line (dark)
            ctx.strokeStyle = `rgba(0, 0, 0, ${0.7 + power * 0.3})`;
            ctx.lineWidth = this.ss(2.5);
            ctx.beginPath();
            ctx.moveTo(fx, fy);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.setLineDash([]);

            // Arrow head at target
            const angle = Math.atan2(ty - fy, tx - fx);
            const arrowLen = this.ss(12);
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - arrowLen * Math.cos(angle - 0.4), ty - arrowLen * Math.sin(angle - 0.4));
            ctx.moveTo(tx, ty);
            ctx.lineTo(tx - arrowLen * Math.cos(angle + 0.4), ty - arrowLen * Math.sin(angle + 0.4));
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            ctx.lineWidth = this.ss(3);
            ctx.stroke();
        }

        drawNextStonePreview(x, y, team) {
            const ctx = this.ctx;
            const cx = this.sx(x);
            const cy = this.sy(y);
            const r = this.ss(STONE_RADIUS);

            // Pulsing glow
            const t = Date.now() / 1000;
            const glowAlpha = 0.2 + 0.15 * Math.sin(t * 3);

            ctx.beginPath();
            ctx.arc(cx, cy, r + this.ss(4), 0, Math.PI * 2);
            ctx.fillStyle = team === 0
                ? `rgba(239, 68, 68, ${glowAlpha})`
                : `rgba(234, 179, 8, ${glowAlpha})`;
            ctx.fill();

            // Ghost stone
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.fillStyle = team === 0
                ? 'rgba(239, 68, 68, 0.3)'
                : 'rgba(234, 179, 8, 0.3)';
            ctx.fill();
            ctx.strokeStyle = team === 0
                ? 'rgba(239, 68, 68, 0.6)'
                : 'rgba(234, 179, 8, 0.6)';
            ctx.lineWidth = this.ss(1.5);
            ctx.setLineDash([this.ss(4), this.ss(4)]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        drawSweepZones(zones) {
            const ctx = this.ctx;
            const now = Date.now();
            for (const zone of zones) {
                const age = now - zone.time;
                let alpha = 0.35;
                if (age > SWEEP_FADE_TIME) {
                    alpha = Math.max(0, 0.35 - (age - SWEEP_FADE_TIME) / 3000 * 0.35);
                }
                if (alpha <= 0) continue;

                // Swept ice effect: lighter, smoother area
                ctx.beginPath();
                ctx.arc(this.sx(zone.x), this.sy(zone.y), this.ss(zone.radius), 0, Math.PI * 2);
                ctx.fillStyle = `rgba(200, 230, 255, ${alpha})`;
                ctx.fill();

                // Subtle brush stroke lines
                ctx.strokeStyle = `rgba(255, 255, 255, ${alpha * 0.5})`;
                ctx.lineWidth = this.ss(0.8);
                const cx = this.sx(zone.x);
                const cy = this.sy(zone.y);
                const r = this.ss(zone.radius);
                for (let i = -2; i <= 2; i++) {
                    ctx.beginPath();
                    ctx.moveTo(cx + i * r * 0.25, cy - r * 0.6);
                    ctx.lineTo(cx + i * r * 0.25, cy + r * 0.6);
                    ctx.stroke();
                }
            }
        }

        drawBroomCursor(x, y) {
            const ctx = this.ctx;
            const cx = this.sx(x);
            const cy = this.sy(y);

            // Broom head
            ctx.save();
            ctx.translate(cx, cy);

            // Handle
            ctx.strokeStyle = '#8B4513';
            ctx.lineWidth = this.ss(2.5);
            ctx.beginPath();
            ctx.moveTo(0, -this.ss(25));
            ctx.lineTo(0, this.ss(5));
            ctx.stroke();

            // Brush head
            ctx.fillStyle = '#D2B48C';
            ctx.fillRect(-this.ss(10), this.ss(3), this.ss(20), this.ss(8));

            // Bristles
            ctx.strokeStyle = '#C8A86E';
            ctx.lineWidth = this.ss(1);
            for (let i = -4; i <= 4; i++) {
                ctx.beginPath();
                ctx.moveTo(i * this.ss(2.2), this.ss(11));
                ctx.lineTo(i * this.ss(2.2), this.ss(16));
                ctx.stroke();
            }

            ctx.restore();

            // Sweep radius indicator
            ctx.beginPath();
            ctx.arc(cx, cy, this.ss(SWEEP_RADIUS), 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(200, 230, 255, 0.4)';
            ctx.lineWidth = this.ss(1);
            ctx.setLineDash([this.ss(4), this.ss(4)]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        drawRoughZones(zones) {
            const ctx = this.ctx;
            for (const zone of zones) {
                const cx = this.sx(zone.x);
                const cy = this.sy(zone.y);
                const r = this.ss(zone.radius);

                // Darker ice patch
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(80, 60, 40, 0.15)';
                ctx.fill();

                // Cracks / scratches pattern
                ctx.strokeStyle = 'rgba(100, 80, 60, 0.2)';
                ctx.lineWidth = this.ss(0.5);
                for (let i = 0; i < 5; i++) {
                    const angle = (i / 5) * Math.PI * 2 + zone.x * 0.1;
                    const len = r * (0.3 + Math.random() * 0.4);
                    ctx.beginPath();
                    ctx.moveTo(cx + Math.cos(angle) * len * 0.2, cy + Math.sin(angle) * len * 0.2);
                    ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
                    ctx.stroke();
                }

                // Border
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(100, 80, 60, 0.12)';
                ctx.lineWidth = this.ss(1);
                ctx.stroke();
            }
        }

        get sheetBounds() {
            return {
                left: 0,
                right: SHEET.width,
                top: 0,
                bottom: SHEET.length
            };
        }
    }

    // ============================================================
    // SCORING
    // ============================================================
    function calculateScore(stones) {
        const houseCenter = { x: SHEET.width / 2, y: SHEET.houseCenterY };
        const maxDist = SHEET.houseRadius + STONE_RADIUS; // stones touching house count

        // Get distances from button for each stone in the house
        const inHouse = stones
            .filter(s => s.active && dist(s, houseCenter) <= maxDist)
            .map(s => ({ team: s.team, distance: dist(s, houseCenter) }))
            .sort((a, b) => a.distance - b.distance);

        if (inHouse.length === 0) return { team: -1, points: 0 };

        const closestTeam = inHouse[0].team;

        // Find the closest stone from the OTHER team
        const closestOpponent = inHouse.find(s => s.team !== closestTeam);
        const opponentDist = closestOpponent ? closestOpponent.distance : Infinity;

        // Count scoring stones
        let points = 0;
        for (const s of inHouse) {
            if (s.team === closestTeam && s.distance < opponentDist) {
                points++;
            }
        }

        return { team: closestTeam, points };
    }

    // ============================================================
    // NETWORK MANAGER
    // ============================================================
    class NetworkManager {
        constructor() {
            this.socket = null;
            this.nickname = 'Jogador';
            this.myTeam = -1;
            this.lobbyId = -1;
            this.onGameStart = null;
            this.onPlayerAction = null;
            this.onGameState = null;
            this.onOpponentDisconnected = null;
            this.onGameOverResult = null;
            this.onLobbyUpdate = null;
        }

        connect() {
            this.socket = io();

            this.socket.on('connect', () => {
                console.log('[NET] Connected:', this.socket.id);
                const dot = document.querySelector('.conn-dot');
                if (dot) { dot.className = 'conn-dot connected'; }
            });

            this.socket.on('disconnect', () => {
                console.log('[NET] Disconnected');
                const dot = document.querySelector('.conn-dot');
                if (dot) { dot.className = 'conn-dot disconnected'; }
            });

            this.socket.on('lobbies-update', (lobbies) => {
                this.renderLobbies(lobbies);
            });

            this.socket.on('lobby-update', (data) => {
                if (this.onLobbyUpdate) this.onLobbyUpdate(data);
                this.updateWaitingRoom(data);
            });

            this.socket.on('game-start', (data) => {
                if (this.onGameStart) this.onGameStart(data);
            });

            this.socket.on('player-action', (action) => {
                if (this.onPlayerAction) this.onPlayerAction(action);
            });

            this.socket.on('game-state', (state) => {
                if (this.onGameState) this.onGameState(state);
            });

            this.socket.on('opponent-disconnected', (data) => {
                if (this.onOpponentDisconnected) this.onOpponentDisconnected(data);
            });

            this.socket.on('game-over-result', (result) => {
                if (this.onGameOverResult) this.onGameOverResult(result);
            });

            // Server info (version + online count)
            this.socket.on('server-info', (info) => {
                const badge = document.getElementById('versionBadge');
                if (badge) badge.textContent = `v${info.version}`;
                const count = document.getElementById('onlineCount');
                if (count) count.textContent = `${info.onlineCount} online`;
            });

            this.socket.on('online-count', (n) => {
                const count = document.getElementById('onlineCount');
                if (count) count.textContent = `${n} online`;
            });
        }

        setNickname(name, flag) {
            this.nickname = name;
            this.flag = flag;
            this.socket.emit('set-nickname', { name, flag });
        }

        getLobbies(callback) {
            this.socket.emit('get-lobbies', callback);
        }

        joinLobby(lobbyId, callback) {
            this.socket.emit('join-lobby', lobbyId, (result) => {
                if (result.success) {
                    this.myTeam = result.team;
                    this.lobbyId = result.lobbyId;
                }
                callback(result);
            });
        }

        leaveLobby() {
            this.socket.emit('leave-lobby');
            this.myTeam = -1;
            this.lobbyId = -1;
        }

        sendAction(action) {
            this.socket.emit('player-action', action);
        }

        sendGameState(state) {
            this.socket.emit('game-state', state);
        }

        sendGameOver(result) {
            this.socket.emit('game-over', result);
        }

        renderLobbies(lobbies) {
            const grid = document.getElementById('roomGrid');
            if (!grid) return;
            grid.innerHTML = '';
            for (const l of lobbies) {
                const card = document.createElement('div');
                card.className = 'room-card' + (l.playerCount >= 2 ? ' full' : '') + (l.status === 'playing' ? ' playing' : '');
                const statusClass = l.playerCount === 0 ? 'empty' : l.status === 'playing' ? 'playing' : 'waiting';
                const statusText = l.playerCount === 0 ? 'VAZIA' : l.status === 'playing' ? 'JOGANDO' : 'AGUARDANDO';
                const names = l.players.map(p => p.nickname).join(', ') || '—';
                card.innerHTML = `
                    <div class="room-card-header">
                        <span class="room-number">Sala ${l.id}</span>
                        <span class="room-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="room-players">${l.playerCount}/2 jogadores</div>
                    <div class="room-player-names">${names}</div>
                `;
                if (l.playerCount < 2 && l.status !== 'playing') {
                    card.addEventListener('click', () => this.joinLobby(l.id, (res) => {
                        if (res.error) { alert(res.error); return; }
                        this.showWaitingRoom(l.id);
                    }));
                }
                grid.appendChild(card);
            }
        }

        showWaitingRoom(lobbyId) {
            document.getElementById('roomBrowser').classList.remove('active');
            document.getElementById('waitingRoom').classList.add('active');
            document.getElementById('waitingRoomId').textContent = lobbyId;
        }

        updateWaitingRoom(data) {
            const p1 = data.players[0];
            const p2 = data.players[1];
            document.getElementById('waitP1Name').textContent = p1 ? p1.nickname : '—';
            document.getElementById('waitP2Name').textContent = p2 ? p2.nickname : 'Aguardando...';
        }
    }

    // ============================================================
    // GAME MANAGER
    // ============================================================
    class GameManager {
        constructor() {
            this.canvas = document.getElementById('gameCanvas');
            this.renderer = new Renderer(this.canvas);
            this.physics = new PhysicsEngine();
            this.net = new NetworkManager();

            // Screens
            this.nicknameScreen = document.getElementById('nicknameScreen');
            this.roomBrowser = document.getElementById('roomBrowser');
            this.waitingRoom = document.getElementById('waitingRoom');
            this.gameScreen = document.getElementById('gameScreen');

            // Force panel elements
            this.forcePanel = document.getElementById('forcePanel');
            this.forceSliderTrack = document.getElementById('forceSliderTrack');
            this.forceSliderFill = document.getElementById('forceSliderFill');
            this.forceSliderThumb = document.getElementById('forceSliderThumb');
            this.forceValueEl = document.getElementById('forceValue');
            this.btnLaunch = document.getElementById('btnLaunch');
            this.btnCancelAim = document.getElementById('btnCancelAim');

            // Game state
            this.team1Name = 'Equipe Vermelha';
            this.team2Name = 'Equipe Amarela';
            this.totalEnds = 8;
            this.currentEnd = 1;
            this.scores = [0, 0];
            this.stonesThrown = [0, 0];
            this.currentTeam = 0;
            this.hammer = 1;
            this.state = 'lobby';

            // Aiming system
            this.launchPos = { x: SHEET.width / 2, y: SHEET.length - SHEET.hackFromEnd - 30 };
            this.isDragging = false;
            this.dragStart = null;
            this.dragEnd = null;
            this.aimTarget = null;
            this.power = 0;
            this.sliderDragging = false;

            // Sweeping system
            this.isSweeping = false;
            this.sweepCursorPos = null;
            this.sweepEnergy = MAX_SWEEP_ENERGY;

            // Aim timer & wobble
            this.aimStartTime = 0;
            this.wobbleOffset = 0;

            // Free guard zone
            this.preThrowPositions = [];

            // Pebble pattern seed
            this.pebbleSeed = [];

            // Multiplayer
            this.isMyTurn = false;
            this.teamFlags = [null, null];

            // Per-end score history for live table
            this.endScores = []; // [{t1: 0, t2: 0}, ...]

            this.setupLobby();
            this.setupInput();
            this.loop();
        }

        // ------ LOBBY & NETWORK ------
        setupLobby() {
            // Connect to server
            this.net.connect();

            // Flag selection
            let selectedFlag = null;
            const flagGrid = document.getElementById('flagGrid');
            const flagHint = document.getElementById('flagHint');
            const btnSetNickname = document.getElementById('btnSetNickname');

            flagGrid.addEventListener('click', (e) => {
                const btn = e.target.closest('.flag-btn');
                if (!btn) return;
                flagGrid.querySelectorAll('.flag-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                selectedFlag = btn.dataset.flag;
                flagHint.textContent = btn.title;
                flagHint.classList.add('selected');
                btnSetNickname.disabled = false;
            });

            // Nickname screen
            btnSetNickname.addEventListener('click', () => {
                if (!selectedFlag) return;
                const name = document.getElementById('nicknameInput').value.trim() || 'Jogador';
                this.net.setNickname(name, selectedFlag);
                document.getElementById('myNickname').textContent = `${selectedFlag} ${name}`;

                this.nicknameScreen.classList.remove('active');
                this.roomBrowser.classList.add('active');

                this.net.getLobbies((lobbies) => this.net.renderLobbies(lobbies));
            });

            document.getElementById('nicknameInput').addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('btnSetNickname').click();
            });

            // Leave room button
            document.getElementById('btnLeaveRoom').addEventListener('click', () => {
                this.net.leaveLobby();
                this.waitingRoom.classList.remove('active');
                this.roomBrowser.classList.add('active');
                this.net.getLobbies((lobbies) => this.net.renderLobbies(lobbies));
            });

            // Game start callback
            this.net.onGameStart = (data) => {
                this.team1Name = data.players[0].nickname;
                this.team2Name = data.players[1].nickname;
                this.teamFlags = [data.players[0].flag || '🏳️', data.players[1].flag || '🏳️'];
                this.startGame();
            };

            // Receive opponent actions
            this.net.onPlayerAction = (action) => {
                this.handleRemoteAction(action);
            };

            // Receive game state sync
            this.net.onGameState = (state) => {
                this.syncFromRemote(state);
            };

            // Opponent disconnected
            this.net.onOpponentDisconnected = (data) => {
                document.getElementById('disconnectMsg').textContent = `${data.nickname} saiu da partida.`;
                document.getElementById('disconnectModal').classList.add('visible');
            };

            document.getElementById('btnDisconnectBack').addEventListener('click', () => {
                document.getElementById('disconnectModal').classList.remove('visible');
                this.gameScreen.classList.remove('active');
                this.roomBrowser.classList.add('active');
                this.state = 'lobby';
                this.net.leaveLobby();
                this.net.getLobbies((lobbies) => this.net.renderLobbies(lobbies));
            });

            // Next end button
            document.getElementById('btnNextEnd').addEventListener('click', () => {
                document.getElementById('endModal').classList.remove('visible');
                this.startEnd();
            });

            // Back to lobby button
            document.getElementById('btnBackToLobby').addEventListener('click', () => {
                document.getElementById('gameOverModal').classList.remove('visible');
                this.gameScreen.classList.remove('active');
                this.roomBrowser.classList.add('active');
                this.state = 'lobby';
                this.net.leaveLobby();
                this.net.getLobbies((lobbies) => this.net.renderLobbies(lobbies));
            });
        }

        handleRemoteAction(action) {
            switch (action.type) {
                case 'launch':
                    // Opponent launched a stone
                    this.aimTarget = action.aimTarget;
                    this.power = action.power;
                    this.currentTeam = action.team;
                    // Sync rough zones from launcher if provided
                    if (action.roughZones) {
                        this.physics.roughZones = action.roughZones;
                    }
                    this.launchStoneFromAction(action);
                    break;
                case 'sweep':
                    // Opponent swept at position
                    this.physics.addSweepZone(action.x, action.y);
                    this.sweepCursorPos = { x: action.x, y: action.y };
                    break;
                case 'timeout':
                    // Opponent's timer ran out — skip their stone
                    this.stonesThrown[action.team]++;
                    this.nextTurn();
                    break;
                case 'sync-stones':
                    // Authoritative stone positions from active player
                    this.applyStoneSyncFromRemote(action.stones);
                    break;
                case 'end-end':
                    // Sync end results
                    break;
            }
        }

        launchStoneFromAction(action) {
            const stone = new Stone(action.team, this.launchPos.x, this.launchPos.y);
            stone.vx = action.vx;
            stone.vy = action.vy;

            this.preThrowPositions = this.physics.stones.map(s => ({
                team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy, active: s.active
            }));

            this.physics.addStone(stone);
            this.physics.clearSweepZones();
            this.stonesThrown[action.team]++;
            this.state = 'waiting';
            this.sweepEnergy = MAX_SWEEP_ENERGY;
            document.getElementById('sweepHint').classList.add('visible');
        }

        syncFromRemote(state) {
            // Lightweight state sync for end results
            if (state.scores) this.scores = state.scores;
            if (state.currentEnd) this.currentEnd = state.currentEnd;
            if (state.hammer !== undefined) this.hammer = state.hammer;
            this.updateScoreboard();
        }

        applyStoneSyncFromRemote(stonesData) {
            // Replace all local stone positions with authoritative data from launcher
            // Rebuild the stones array to match the launcher's state exactly
            this.physics.stones = stonesData.map(sd => {
                const s = new Stone(sd.team, sd.x, sd.y);
                s.vx = sd.vx;
                s.vy = sd.vy;
                s.active = sd.active;
                return s;
            });
        }

        startGame() {
            document.getElementById('team1Label').textContent = this.team1Name;
            document.getElementById('team2Label').textContent = this.team2Name;
            document.getElementById('endTotal').textContent = `/ ${this.totalEnds}`;

            this.scores = [0, 0];
            this.currentEnd = 1;
            this.hammer = 1;
            this.updateScoreboard();

            // Set team names in live score table
            document.getElementById('liveTeam1Name').textContent = this.team1Name;
            document.getElementById('liveTeam2Name').textContent = this.team2Name;
            this.endScores = [];
            this.updateLiveScoreTable();

            // Generate pebble pattern
            this.pebbleSeed = [];
            for (let i = 0; i < 500; i++) {
                this.pebbleSeed.push({
                    x: Math.random() * SHEET.width,
                    y: Math.random() * SHEET.length,
                    r: 0.8 + Math.random() * 0.8
                });
            }

            // Hide all lobby screens, show game
            this.nicknameScreen.classList.remove('active');
            this.roomBrowser.classList.remove('active');
            this.waitingRoom.classList.remove('active');
            this.gameScreen.classList.add('active');

            this.renderer.resize();
            this.startEnd();
        }

        startEnd() {
            this.physics.clearAll();
            this.stonesThrown = [0, 0];
            this.physics.generateRoughZones();
            this.currentTeam = this.hammer === 1 ? 0 : 1;
            this.isMyTurn = (this.currentTeam === this.net.myTeam);
            this.state = 'aiming';
            this.aimStartTime = Date.now();
            this.sweepEnergy = MAX_SWEEP_ENERGY;
            this.updateUI();
        }

        // ------ INPUT ------
        setupInput() {
            const canvas = this.canvas;

            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const touch = e.touches && e.touches.length > 0 ? e.touches[0] : (e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0] : null);
                const clientX = touch ? touch.clientX : e.clientX;
                const clientY = touch ? touch.clientY : e.clientY;
                return { px: clientX - rect.left, py: clientY - rect.top };
            };

            const onDown = (e) => {
                e.preventDefault();
                const { px, py } = getPos(e);

                if (this.state === 'aiming' && this.isMyTurn) {
                    this.isDragging = true;
                    this.dragStart = { px, py };
                    this.dragEnd = { px, py };
                } else if (this.state === 'waiting' && this.sweepEnergy > 0) {
                    // Start sweeping (only if energy available)
                    this.isSweeping = true;
                    const gp = this.renderer.toGame(px, py);
                    this.sweepCursorPos = gp;
                    this.physics.addSweepZone(gp.x, gp.y);
                    this.sweepEnergy = Math.max(0, this.sweepEnergy - SWEEP_DRAIN_RATE);
                    this.canvas.style.cursor = 'none';
                }
            };

            const onMove = (e) => {
                e.preventDefault();
                const pos = getPos(e);

                if (this.state === 'waiting') {
                    const gp = this.renderer.toGame(pos.px, pos.py);
                    this.sweepCursorPos = gp;

                    if (this.isSweeping && this.sweepEnergy > 0) {
                        this.physics.addSweepZone(gp.x, gp.y);
                        this.sweepEnergy = Math.max(0, this.sweepEnergy - SWEEP_DRAIN_RATE);
                        // Send sweep to opponent
                        this.net.sendAction({ type: 'sweep', x: gp.x, y: gp.y });
                        if (this.sweepEnergy <= 0) {
                            this.isSweeping = false;
                            this.canvas.style.cursor = 'crosshair';
                        }
                    }
                    return;
                }

                if (!this.isDragging || this.state !== 'aiming') return;
                this.dragEnd = pos;

                // Calculate direction only (no power from drag)
                const dx = this.dragStart.px - this.dragEnd.px;
                const dy = this.dragStart.py - this.dragEnd.py;
                const dragDist = Math.sqrt(dx * dx + dy * dy);

                // Aim target direction (opposite of drag — natural slingshot feel)
                const gameStart = this.renderer.toGame(this.dragStart.px, this.dragStart.py);
                const gameEnd = this.renderer.toGame(this.dragEnd.px, this.dragEnd.py);

                const dirX = gameStart.x - gameEnd.x;
                const dirY = gameStart.y - gameEnd.y;
                const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);

                if (dirLen > 2) {
                    const normX = dirX / dirLen;
                    const normY = dirY / dirLen;
                    this.aimTarget = {
                        x: this.launchPos.x + normX * 150,
                        y: this.launchPos.y + normY * 150
                    };
                }

                // Show a temporary power preview based on drag for visual feedback
                this.power = clamp(dragDist / 200, 0, 1);
            };

            const onUp = (e) => {
                if (this.isSweeping) {
                    this.isSweeping = false;
                    this.canvas.style.cursor = 'crosshair';
                    return;
                }

                if (!this.isDragging || this.state !== 'aiming' || !this.isMyTurn) return;
                this.isDragging = false;

                // If a valid aim direction was set, transition to aim_locked
                if (this.aimTarget) {
                    this.state = 'aim_locked';
                    // Set default power to 50% for the slider
                    this.power = 0.5;
                    this.updateForceSlider(this.power);
                    this.forcePanel.classList.add('visible');
                } else {
                    this.aimTarget = null;
                    this.power = 0;
                }
            };

            canvas.addEventListener('mousedown', onDown);
            canvas.addEventListener('mousemove', onMove);
            canvas.addEventListener('mouseup', onUp);
            canvas.addEventListener('mouseleave', (e) => {
                if (this.isSweeping) {
                    this.isSweeping = false;
                    this.canvas.style.cursor = 'crosshair';
                } else if (this.state === 'aiming') {
                    onUp(e);
                }
            });

            canvas.addEventListener('touchstart', onDown, { passive: false });
            canvas.addEventListener('touchmove', onMove, { passive: false });
            canvas.addEventListener('touchend', onUp);

            // --- Force Slider Interaction ---
            const getSliderRatio = (e) => {
                const rect = this.forceSliderTrack.getBoundingClientRect();
                const touch = e.touches && e.touches.length > 0 ? e.touches[0] : (e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0] : null);
                const clientX = touch ? touch.clientX : e.clientX;
                const clientY = touch ? touch.clientY : e.clientY;

                // Detect if vertical (height > width)
                const isVertical = rect.height > rect.width;

                if (isVertical) {
                    // Vertical: 0 at bottom, 1 at top
                    // normalized pos from top
                    const relativeY = (clientY - rect.top);
                    // inverse because Y grows down
                    return clamp(1 - (relativeY / rect.height), 0, 1);
                } else {
                    // Horizontal: 0 at left, 1 at right
                    return clamp((clientX - rect.left) / rect.width, 0, 1);
                }
            };

            const onSliderDown = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.sliderDragging = true;
                const ratio = getSliderRatio(e);
                this.power = ratio;
                this.updateForceSlider(ratio);
            };

            const onSliderMove = (e) => {
                if (!this.sliderDragging) return;
                e.preventDefault();
                e.stopPropagation();
                const ratio = getSliderRatio(e);
                this.power = ratio;
                this.updateForceSlider(ratio);
            };

            const onSliderUp = (e) => {
                if (!this.sliderDragging) return;
                this.sliderDragging = false;
            };

            this.forceSliderTrack.addEventListener('mousedown', onSliderDown);
            this.forceSliderThumb.addEventListener('mousedown', onSliderDown);
            document.addEventListener('mousemove', onSliderMove);
            document.addEventListener('mouseup', onSliderUp);

            this.forceSliderTrack.addEventListener('touchstart', onSliderDown, { passive: false });
            this.forceSliderThumb.addEventListener('touchstart', onSliderDown, { passive: false });
            document.addEventListener('touchmove', onSliderMove, { passive: false });
            document.addEventListener('touchend', onSliderUp);

            // --- Launch Button ---
            this.btnLaunch.addEventListener('click', () => {
                if (this.state !== 'aim_locked') return;
                if (this.power < 0.03) this.power = 0.03; // minimum force
                this.forcePanel.classList.remove('visible');
                this.launchStone();
            });

            // --- Cancel Button ---
            this.btnCancelAim.addEventListener('click', () => {
                if (this.state !== 'aim_locked') return;
                this.forcePanel.classList.remove('visible');
                this.state = 'aiming';
                this.aimTarget = null;
                this.power = 0;
            });

            window.addEventListener('resize', () => {
                if (this.state !== 'lobby') {
                    this.renderer.resize();
                }
            });
        }

        updateForceSlider(ratio) {
            const pct = Math.round(ratio * 100);
            const rect = this.forceSliderTrack.getBoundingClientRect();
            const isVertical = rect.height > rect.width;

            if (isVertical) {
                this.forceSliderFill.style.width = '100%';
                this.forceSliderFill.style.height = `${pct}%`;
                // For vertical, thumb follows bottom position
                this.forceSliderThumb.style.left = '50%';
                this.forceSliderThumb.style.bottom = `${pct}%`;
                this.forceSliderThumb.style.top = 'auto'; // Clear top
            } else {
                this.forceSliderFill.style.height = '100%';
                this.forceSliderFill.style.width = `${pct}%`;
                this.forceSliderThumb.style.left = `${pct}%`;
                this.forceSliderThumb.style.bottom = 'auto'; // Clear bottom
                this.forceSliderThumb.style.top = '50%';
            }
            this.forceValueEl.textContent = `${pct}%`;
        }

        launchStone() {
            const stone = new Stone(this.currentTeam, this.launchPos.x, this.launchPos.y);

            // Direction toward aim target WITH wobble applied
            const dx = this.aimTarget.x - this.launchPos.x;
            const dy = this.aimTarget.y - this.launchPos.y;
            const baseAngle = Math.atan2(dy, dx);
            const wobble = AIM_WOBBLE_AMOUNT * Math.sin(Date.now() * 0.001 * AIM_WOBBLE_SPEED) * (0.5 + this.power * 0.5);
            const finalAngle = baseAngle + wobble;

            const speed = this.power * MAX_LAUNCH_SPEED;
            stone.vx = Math.cos(finalAngle) * speed;
            stone.vy = Math.sin(finalAngle) * speed;

            // Build launch action
            const launchAction = {
                type: 'launch',
                team: this.currentTeam,
                vx: stone.vx,
                vy: stone.vy,
                power: this.power,
                aimTarget: this.aimTarget
            };

            // Include rough zones on first launch of the end so both clients match
            const totalThrown = this.stonesThrown[0] + this.stonesThrown[1];
            if (totalThrown === 0) {
                launchAction.roughZones = this.physics.roughZones;
            }

            // Send launch action to opponent
            this.net.sendAction(launchAction);

            // Mark as launch owner so we send sync after physics settle
            this.isLaunchOwner = true;

            // Save pre-throw positions for Free Guard Zone enforcement
            this.preThrowPositions = this.physics.stones.map(s => ({
                team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy, active: s.active
            }));

            this.physics.addStone(stone);
            this.physics.clearSweepZones();
            this.stonesThrown[this.currentTeam]++;
            this.state = 'waiting';
            this.sweepEnergy = MAX_SWEEP_ENERGY;

            // Show sweep hint
            document.getElementById('sweepHint').classList.add('visible');
        }

        // ------ GAME LOGIC ------
        nextTurn() {
            const totalThrown = this.stonesThrown[0] + this.stonesThrown[1];

            // All 16 stones thrown → end is over
            if (totalThrown >= 16) {
                this.endEnd();
                return;
            }

            // Alternate teams
            const otherTeam = this.currentTeam === 0 ? 1 : 0;
            if (this.stonesThrown[otherTeam] < 8) {
                this.currentTeam = otherTeam;
            }

            // Enter cooldown before allowing next aim
            this.state = 'cooldown';
            this.cooldownStart = Date.now();
            this.cooldownDuration = 2000; // 2 seconds
            this.isMyTurn = (this.currentTeam === this.net.myTeam);
            this.updateUI();
        }

        endEnd() {
            const result = calculateScore(this.physics.stones);

            let endPoints = [0, 0];
            if (result.team >= 0) {
                endPoints[result.team] = result.points;
                this.scores[result.team] += result.points;

                // Hammer goes to the team that did NOT score
                this.hammer = result.team === 0 ? 1 : 0;
            } else {
                // Blank end — hammer stays
            }

            this.state = 'end_over';

            document.getElementById('endTitle').textContent = `Fim do End ${this.currentEnd}`;
            document.getElementById('modalTeam1Name').textContent = this.team1Name;
            document.getElementById('modalTeam2Name').textContent = this.team2Name;
            document.getElementById('modalTeam1Pts').textContent = `+${endPoints[0]}`;
            document.getElementById('modalTeam2Pts').textContent = `+${endPoints[1]}`;
            document.getElementById('modalTotal1').textContent = this.scores[0];
            document.getElementById('modalTotal2').textContent = this.scores[1];

            // Record this end's scores
            this.endScores.push({ t1: endPoints[0], t2: endPoints[1] });
            this.updateLiveScoreTable();

            this.currentEnd++;
            this.updateScoreboard();

            if (this.currentEnd > this.totalEnds) {
                document.getElementById('btnNextEnd').querySelector('span').textContent = 'Ver Resultado';
                document.getElementById('btnNextEnd').onclick = () => {
                    document.getElementById('endModal').classList.remove('visible');
                    this.showGameOver();
                };
            } else {
                document.getElementById('btnNextEnd').querySelector('span').textContent = 'Próximo End';
                document.getElementById('btnNextEnd').onclick = () => {
                    document.getElementById('endModal').classList.remove('visible');
                    this.startEnd();
                };
            }

            document.getElementById('endModal').classList.add('visible');
        }

        showGameOver() {
            let winnerText;
            if (this.scores[0] > this.scores[1]) {
                winnerText = `${this.team1Name} Venceu!`;
            } else if (this.scores[1] > this.scores[0]) {
                winnerText = `${this.team2Name} Venceu!`;
            } else {
                winnerText = 'Empate!';
            }

            document.getElementById('gameOverTitle').textContent = winnerText;
            document.getElementById('finalScore1').textContent = this.scores[0];
            document.getElementById('finalScore2').textContent = this.scores[1];

            this.state = 'game_over';
            document.getElementById('gameOverModal').classList.add('visible');

            // Notify server
            this.net.sendGameOver({ scores: this.scores, winner: winnerText });
        }

        updateScoreboard() {
            document.getElementById('score1').textContent = this.scores[0];
            document.getElementById('score2').textContent = this.scores[1];
            document.getElementById('endNumber').textContent = Math.min(this.currentEnd, this.totalEnds);
        }

        updateUI() {
            this.updateScoreboard();

            const team1Stones = 8 - this.stonesThrown[0];
            const team2Stones = 8 - this.stonesThrown[1];
            document.getElementById('stonesInfo').textContent = `Pedras: 🔴${team1Stones}  🟡${team2Stones}`;

            const turnDot = document.querySelector('.turn-dot');
            const turnText = document.getElementById('turnText');
            const currentName = this.currentTeam === 0 ? this.team1Name : this.team2Name;

            if (this.currentTeam === 0) {
                turnDot.style.background = 'var(--red-team)';
            } else {
                turnDot.style.background = 'var(--yellow-team)';
            }

            if (this.isMyTurn) {
                turnText.textContent = `SUA VEZ (${currentName})`;
            } else {
                turnText.textContent = `Vez: ${currentName}`;
            }

            // Hammer indicator update
            const t1Hammer = document.querySelector('#team1ScoreBox .hammer-indicator');
            const t2Hammer = document.querySelector('#team2ScoreBox .hammer-indicator');

            if (this.hammer === 0) {
                t1Hammer.classList.add('active');
                t2Hammer.classList.remove('active');
            } else {
                t1Hammer.classList.remove('active');
                t2Hammer.classList.add('active');
            }
        }

        updateLiveScoreTable() {
            // Fill in per-end historical scores
            for (let e = 1; e <= 8; e++) {
                const t1Cell = document.getElementById(`e${e}t1`);
                const t2Cell = document.getElementById(`e${e}t2`);
                if (e <= this.endScores.length) {
                    const es = this.endScores[e - 1];
                    t1Cell.textContent = es.t1;
                    t2Cell.textContent = es.t2;
                    t1Cell.className = es.t1 > 0 ? 'end-scored' : '';
                    t2Cell.className = es.t2 > 0 ? 'end-scored' : '';
                } else if (e === this.currentEnd) {
                    t1Cell.textContent = '·';
                    t2Cell.textContent = '·';
                    t1Cell.className = 'end-active';
                    t2Cell.className = 'end-active';
                } else {
                    t1Cell.textContent = '-';
                    t2Cell.textContent = '-';
                    t1Cell.className = '';
                    t2Cell.className = '';
                }
            }

            // Live scoring from current stone positions
            const liveResult = calculateScore(this.physics.stones);
            let liveT1 = 0, liveT2 = 0;
            if (liveResult.team === 0) liveT1 = liveResult.points;
            if (liveResult.team === 1) liveT2 = liveResult.points;
            document.getElementById('liveT1').textContent = liveT1;
            document.getElementById('liveT2').textContent = liveT2;

            // Totals (accumulated + live)
            document.getElementById('totalT1').textContent = this.scores[0] + liveT1;
            document.getElementById('totalT2').textContent = this.scores[1] + liveT2;

            // Highlight current end header
            for (let e = 1; e <= 8; e++) {
                const th = document.getElementById(`endH${e}`);
                if (th) {
                    th.className = (e === this.currentEnd) ? 'end-active' : '';
                }
            }
        }

        // ------ GAME LOOP ------
        loop() {
            if (this.state !== 'lobby') {
                this.update();
                this.render();
            }
            requestAnimationFrame(() => this.loop());
        }

        update() {
            // Aim timer — auto-skip if time runs out (only active player triggers timeout)
            if ((this.state === 'aiming' || this.state === 'aim_locked') && this.isMyTurn) {
                const elapsed = Date.now() - this.aimStartTime;
                // Extend time limit if aim is locked (user is adjusting force)
                const limit = (this.state === 'aim_locked') ? 35000 : AIM_TIME_LIMIT;

                if (elapsed >= limit) {
                    // Notify opponent about timeout
                    this.net.sendAction({ type: 'timeout', team: this.currentTeam });
                    this.stonesThrown[this.currentTeam]++;
                    this.isDragging = false;
                    this.aimTarget = null;
                    this.power = 0;
                    this.forcePanel.classList.remove('visible');
                    this.nextTurn();
                    return;
                }
            }

            // Cooldown timer between turns
            if (this.state === 'cooldown') {
                const elapsed = Date.now() - this.cooldownStart;
                if (elapsed >= this.cooldownDuration) {
                    this.state = 'aiming';
                    this.aimStartTime = Date.now();
                    this.sweepEnergy = MAX_SWEEP_ENERGY;
                    this.physics.clearSweepZones();
                }
            }

            if (this.state === 'waiting') {
                this.physics.update(this.renderer.sheetBounds, this.currentEnd);

                if (!this.physics.anyMoving) {
                    // If we launched this stone, send authoritative positions to opponent
                    if (this.isLaunchOwner) {
                        this.isLaunchOwner = false;
                        const stoneData = this.physics.stones.map(s => ({
                            team: s.team, x: s.x, y: s.y, vx: s.vx, vy: s.vy, active: s.active
                        }));
                        this.net.sendAction({ type: 'sync-stones', stones: stoneData });
                    }

                    // Free Guard Zone enforcement
                    this.enforceFreeGuardZone();

                    this.checkHogLine();
                    this.isSweeping = false;
                    this.sweepCursorPos = null;
                    this.canvas.style.cursor = 'crosshair';
                    document.getElementById('sweepHint').classList.remove('visible');
                    this.nextTurn();
                }
            }

            // Update live score table (throttled to every ~10 frames)
            if (!this._liveScoreFrame) this._liveScoreFrame = 0;
            this._liveScoreFrame++;
            if (this._liveScoreFrame % 10 === 0) {
                this.updateLiveScoreTable();
            }
        }

        enforceFreeGuardZone() {
            const totalThrown = this.stonesThrown[0] + this.stonesThrown[1];
            if (totalThrown > FGZ_STONE_COUNT) return; // FGZ only applies for first N stones

            const hogY = SHEET.hogLineFromEnd;
            const houseCenter = { x: SHEET.width / 2, y: SHEET.houseCenterY };
            const houseRadius = SHEET.houseRadius + STONE_RADIUS;

            // Check each pre-throw opponent stone
            for (const pre of this.preThrowPositions) {
                if (pre.team === this.currentTeam) continue; // only protect opponent stones
                if (!pre.active) continue;

                // Was it in the free guard zone? (between hog line and house, but NOT in the house)
                const distToHouse = Math.sqrt((pre.x - houseCenter.x) ** 2 + (pre.y - houseCenter.y) ** 2);
                const inFGZ = pre.y <= hogY && distToHouse > houseRadius;
                if (!inFGZ) continue;

                // Is this stone now missing or moved out of play?
                const currentStone = this.physics.stones.find(s =>
                    s.team === pre.team &&
                    !s.isMoving &&
                    Math.abs(s.x - pre.x) < 1 && Math.abs(s.y - pre.y) < 1
                );

                if (!currentStone) {
                    // Stone was displaced from FGZ — find it and restore it
                    // Find any stone of same team that moved significantly
                    const displaced = this.physics.stones.find(s =>
                        s.team === pre.team && s.active &&
                        (Math.abs(s.x - pre.x) > 2 || Math.abs(s.y - pre.y) > 2)
                    );
                    if (displaced) {
                        displaced.x = pre.x;
                        displaced.y = pre.y;
                        displaced.vx = 0;
                        displaced.vy = 0;
                    } else {
                        // Stone was knocked off — re-add it
                        const restored = new Stone(pre.team, pre.x, pre.y);
                        this.physics.addStone(restored);
                    }

                    // Remove the thrown stone as penalty
                    const thrownStone = this.physics.stones[this.physics.stones.length - 1];
                    if (thrownStone && thrownStone.team === this.currentTeam) {
                        thrownStone.active = false;
                    }
                }
            }

            // Note: inactive stones are kept in array for visual display
        }

        checkHogLine() {
            // Mark stones that didn't pass the center line as inactive
            // (kept in array for visual display until end is over)
            const cutoffY = SHEET.centerLineY;

            for (const s of this.physics.stones) {
                if (s.active && s.y > cutoffY && !s.isMoving) {
                    s.active = false;
                    s.vx = 0;
                    s.vy = 0;
                }
            }
        }

        render() {
            const r = this.renderer;
            const ctx = r.ctx;

            // Draw sheet
            r.drawSheet();

            // Ice degradation visual — slight warm tint in later ends
            if (this.currentEnd > 1) {
                const degradeAlpha = Math.min(0.08, (this.currentEnd - 1) * 0.015);
                ctx.fillStyle = `rgba(180, 160, 120, ${degradeAlpha})`;
                ctx.fillRect(r.sx(0), r.sy(0), r.ss(SHEET.width), r.ss(SHEET.length));
            }

            // Draw pebble pattern
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            for (const p of this.pebbleSeed) {
                ctx.beginPath();
                ctx.arc(r.sx(p.x), r.sy(p.y), r.ss(p.r), 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw rough ice zones
            if (this.physics.roughZones.length > 0) {
                r.drawRoughZones(this.physics.roughZones);
            }

            // Draw swept zones
            if (this.physics.sweepZones.length > 0) {
                r.drawSweepZones(this.physics.sweepZones);
            }

            // Draw all stones
            for (const s of this.physics.stones) {
                const flag = this.teamFlags ? this.teamFlags[s.team] : null;
                r.drawStone(s, flag);
            }

            // Draw broom cursor during waiting state
            if (this.state === 'waiting' && this.sweepCursorPos) {
                r.drawBroomCursor(this.sweepCursorPos.x, this.sweepCursorPos.y);
            }

            // Draw aiming UI with wobble
            if (this.state === 'aiming' || this.state === 'aim_locked') {
                r.drawNextStonePreview(this.launchPos.x, this.launchPos.y, this.currentTeam);

                if (this.aimTarget && (this.isDragging || this.state === 'aim_locked')) {
                    // Apply visual wobble to aim line
                    const dx = this.aimTarget.x - this.launchPos.x;
                    const dy = this.aimTarget.y - this.launchPos.y;
                    const baseAngle = Math.atan2(dy, dx);
                    const len = Math.sqrt(dx * dx + dy * dy);
                    const wobble = AIM_WOBBLE_AMOUNT * Math.sin(Date.now() * 0.001 * AIM_WOBBLE_SPEED) * (0.5 + this.power * 0.5);
                    const wobbledTarget = {
                        x: this.launchPos.x + Math.cos(baseAngle + wobble) * len,
                        y: this.launchPos.y + Math.sin(baseAngle + wobble) * len
                    };
                    r.drawAimLine(this.launchPos, wobbledTarget, this.power);
                }

                // Draw aim timer bar (on canvas bottom)
                const elapsed = Date.now() - this.aimStartTime;
                const limit = (this.state === 'aim_locked') ? 35000 : AIM_TIME_LIMIT;
                const remaining = Math.max(0, 1 - elapsed / limit);
                const barW = r.ss(SHEET.width);
                const barH = r.ss(4);
                const barX = r.sx(0);
                const barY = r.sy(SHEET.length) + r.ss(8);

                // Background
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.fillRect(barX, barY, barW, barH);

                // Timer fill
                const timerColor = remaining > 0.5 ? '#22c55e' : remaining > 0.2 ? '#eab308' : '#ef4444';
                ctx.fillStyle = timerColor;
                ctx.fillRect(barX, barY, barW * remaining, barH);
            }

            // Draw sweep energy bar during waiting state
            if (this.state === 'waiting') {
                const energyRatio = this.sweepEnergy / MAX_SWEEP_ENERGY;
                const barW = r.ss(SHEET.width);
                const barH = r.ss(4);
                const barX = r.sx(0);
                const barY = r.sy(SHEET.length) + r.ss(8);

                // Background
                ctx.fillStyle = 'rgba(255,255,255,0.1)';
                ctx.fillRect(barX, barY, barW, barH);

                // Energy fill
                const energyColor = energyRatio > 0.5 ? '#38bdf8' : energyRatio > 0.2 ? '#eab308' : '#64748b';
                ctx.fillStyle = energyColor;
                ctx.fillRect(barX, barY, barW * energyRatio, barH);

                // Label
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.font = `${r.ss(7)}px Inter, sans-serif`;
                ctx.textAlign = 'left';
                ctx.fillText(`🧹 ${Math.round(energyRatio * 100)}%`, barX + r.ss(2), barY - r.ss(2));
            }

            // Draw cooldown clock between turns
            if (this.state === 'cooldown') {
                const elapsed = Date.now() - this.cooldownStart;
                const remaining = Math.max(0, 1 - elapsed / this.cooldownDuration);
                const secsLeft = Math.ceil((this.cooldownDuration - elapsed) / 1000);

                const cx = r.sx(SHEET.width / 2);
                const cy = r.sy(SHEET.length * 0.55);
                const clockR = r.ss(28);

                // Dark overlay behind clock
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.beginPath();
                ctx.arc(cx, cy, clockR + r.ss(8), 0, Math.PI * 2);
                ctx.fill();

                // Clock background ring
                ctx.beginPath();
                ctx.arc(cx, cy, clockR, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = r.ss(4);
                ctx.stroke();

                // Clock arc (shrinking)
                const arcColor = this.currentTeam === 0 ? '#ef4444' : '#eab308';
                ctx.beginPath();
                ctx.arc(cx, cy, clockR, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * remaining), false);
                ctx.strokeStyle = arcColor;
                ctx.lineWidth = r.ss(4);
                ctx.stroke();

                // Countdown number
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${r.ss(18)}px Inter, sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(secsLeft > 0 ? secsLeft : '⏳', cx, cy);

                // "Próximo turno" label below
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.font = `${r.ss(7)}px Inter, sans-serif`;
                ctx.fillText('Próximo turno', cx, cy + clockR + r.ss(12));
            }
        }
    }

    // ============================================================
    // INIT
    // ============================================================
    window.addEventListener('DOMContentLoaded', () => {
        new GameManager();
    });

})();
