// --- FUNÇÃO COPIAR LINK ---
function copyLink() {
    const tempInput = document.createElement("input");
    tempInput.value = "https://site-murylo-dev.netlify.app/";
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
    
    const msg = document.getElementById("copyMsg");
    msg.classList.add("show");
    setTimeout(() => msg.classList.remove("show"), 2000);
}

// --- SISTEMA DE BACKGROUND: REDE DE PARTÍCULAS + ESTRELAS ---
const canvas = document.getElementById('bg-canvas');
const ctx = canvas.getContext('2d');
let width, height;

let particles = [];
const trails = [];

function initCanvas() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    
    // Inicializa Partículas
    particles = [];
    const particleCount = Math.floor((width * height) / 12000); 
    for (let i = 0; i < particleCount; i++) {
        particles.push({
            x: Math.random() * width,
            y: Math.random() * height,
            vx: (Math.random() - 0.5) * 0.4,
            vy: (Math.random() - 0.5) * 0.4,
            radius: Math.random() * 1.5 + 0.5
        });
    }
}
window.addEventListener('resize', initCanvas);
initCanvas();

// Classe das Estrelas / Rastos de Energia
class EnergyTrail {
    constructor(x, y, vx, vy, isInteractive = false) {
        this.x = x; this.y = y; this.vx = vx; this.vy = vy;
        this.life = 1;
        this.decay = isInteractive ? 0.02 : 0.008; 
        this.thickness = isInteractive ? 2.5 : 1.5;
        
        // Cores dinâmicas (Sky Blue e Violet para modo escuro)
        const colors = ['14, 165, 233', '139, 92, 246']; 
        this.color = colors[Math.floor(Math.random() * colors.length)];
    }

    update() {
        this.x += this.vx; this.y += this.vy; this.life -= this.decay;
    }

    draw(ctx) {
        if (this.life <= 0) return;
        
        const tailLength = 25;
        const tailX = this.x - (this.vx * tailLength);
        const tailY = this.y - (this.vy * tailLength);

        // Cabeça da estrela (Branca/Clara para realçar no escuro)
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.thickness, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${this.life})`;
        ctx.fill();

        // Corpo/rasto da estrela colorido
        const gradient = ctx.createLinearGradient(this.x, this.y, tailX, tailY);
        gradient.addColorStop(0, `rgba(${this.color}, ${this.life})`);
        gradient.addColorStop(1, `rgba(${this.color}, 0)`);

        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(tailX, tailY);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = this.thickness;
        ctx.lineCap = 'round';
        ctx.stroke();
    }
}

// Lógica Touch / Mouse Follower
let lastX = 0, lastY = 0, lastTime = 0;
let toggleSide = true;

window.addEventListener('touchstart', (e) => {
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    lastTime = Date.now();
}, {passive: true});

window.addEventListener('mouseenter', (e) => {
    lastX = e.clientX; lastY = e.clientY;
});

function handleMove(e) {
    const currentX = e.clientX || (e.touches && e.touches[0].clientX);
    const currentY = e.clientY || (e.touches && e.touches[0].clientY);
    if (currentX === undefined) return;

    const dx = currentX - lastX;
    const dy = currentY - lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const now = Date.now();

    if (dist > 15 && now - lastTime > 30) {
        let dirX = dx / dist; let dirY = dy / dist;
        let perpX = -dirY; let perpY = dirX;

        if (!toggleSide) { perpX = -perpX; perpY = -perpY; }
        toggleSide = !toggleSide;

        const offset = 25; 
        const spawnX = currentX + perpX * offset;
        const spawnY = currentY + perpY * offset;

        const speedMultiplier = Math.max(6, dist * 0.3); 
        const vx = dirX * speedMultiplier;
        const vy = dirY * speedMultiplier;

        trails.push(new EnergyTrail(spawnX, spawnY, vx, vy, true));

        lastX = currentX; lastY = currentY; lastTime = now;
    } else if (dist > 0 && now - lastTime > 30) {
        lastX = currentX; lastY = currentY;
    }
}

window.addEventListener('mousemove', handleMove);
window.addEventListener('touchmove', handleMove, {passive: true});

// Loop de Animação Principal
function animate() {
    // Limpa o frame
    ctx.clearRect(0, 0, width, height);

    // 1. DESENHA A REDE DE PARTÍCULAS
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'; // Pontos claros
    for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        
        if (p.x < 0 || p.x > width) p.vx *= -1;
        if (p.y < 0 || p.y > height) p.vy *= -1;
        
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Conexões
        for (let j = i + 1; j < particles.length; j++) {
            const p2 = particles[j];
            const dx = p.x - p2.x; const dy = p.y - p2.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < 100) {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.1 * (1 - distance/100)})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }
        }
    }

    // 2. DESENHA AS ESTRELAS
    if (Math.random() < 0.03) { 
        const startX = Math.random() * width;
        const startY = -50; 
        const vx = (Math.random() - 0.5) * 10; 
        const vy = Math.random() * 8 + 4;
        trails.push(new EnergyTrail(startX, startY, vx, vy, false));
    }

    for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].update();
        trails[i].draw(ctx);
        if (trails[i].life <= 0) trails.splice(i, 1);
    }

    requestAnimationFrame(animate);
}

animate();

// Bloqueia zoom por gesto de pinça
document.addEventListener('gesturestart', function(e) {
    e.preventDefault();
});

document.addEventListener('gesturechange', function(e) {
    e.preventDefault();
});

document.addEventListener('gestureend', function(e) {
    e.preventDefault();
});

// Bloqueia double-tap zoom
let lastTouchEnd = 0;
document.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        e.preventDefault();
    }
    lastTouchEnd = now;
}, false);