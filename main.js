// ===== Word Birds: ULTIMATE EDITION =====
// Features: 关卡制/限时/移动猪/猪藏后面/物理击中/连击疯狂/惩罚弹回/复仇池/学习模式

const WORDS = window.WORDS || [];
if (!WORDS || WORDS.length < 10) {
  alert("词库太少！请检查 words.js 是否正确加载。");
}

// ── 复仇池（间隔重复系统）──────────────────────────────────
// 每个词条：{ word, meaning, immediate, questionsSince, totalLeft }
//   immediate:      还需要立即出现几次（初始=2）
//   questionsSince: 上次复习后过了多少题（达到5就再复习一次）
//   totalLeft:      剩余总复习次数（初始=7，归零后移出）
const REVENGE_POOL = [];

function addToRevenge(wordObj) {
  const ex = REVENGE_POOL.find(r => r.word === wordObj.word);
  if (ex) {
    // 已在池中：重置立即次数和总次数，不重复累加
    ex.immediate  = Math.max(ex.immediate, 2);
    ex.totalLeft  = Math.max(ex.totalLeft, 7);
  } else {
    REVENGE_POOL.push({ word: wordObj.word, meaning: wordObj.meaning,
      immediate: 2, questionsSince: 0, totalLeft: 7 });
  }
}

// 每道新题开始前调用，更新间隔计数
function tickRevenge() {
  REVENGE_POOL.forEach(r => { if (r.immediate === 0) r.questionsSince++; });
}

function pickCorrectWord() {
  // 优先1：有 immediate > 0 的词 → 立即出现
  const imIdx = REVENGE_POOL.findIndex(r => r.immediate > 0);
  if (imIdx >= 0) {
    const r = REVENGE_POOL[imIdx];
    r.immediate--;
    r.totalLeft--;
    if (r.totalLeft <= 0) REVENGE_POOL.splice(imIdx, 1);
    return { word: r.word, meaning: r.meaning };
  }
  // 优先2：间隔计数 >= 5 的词 → 间隔复习
  const spIdx = REVENGE_POOL.findIndex(r => r.immediate === 0 && r.questionsSince >= 5);
  if (spIdx >= 0) {
    const r = REVENGE_POOL[spIdx];
    r.questionsSince = 0;
    r.totalLeft--;
    if (r.totalLeft <= 0) REVENGE_POOL.splice(spIdx, 1);
    return { word: r.word, meaning: r.meaning };
  }
  // 普通随机
  return randPick(WORDS);
}

const W = 900, H = 550;
function shuffle(arr) { return Phaser.Utils.Array.Shuffle(arr.slice()); }
function randPick(arr) { return Phaser.Utils.Array.GetRandom(arr); }

function makeQuestion() {
  tickRevenge();   // 每题开始前推进间隔计数
  const correct = pickCorrectWord();
  const wrongPool = WORDS.filter(w => w.word !== correct.word);
  const w1 = randPick(wrongPool);
  const w2 = randPick(wrongPool.filter(x => x.word !== w1.word));
  return {
    correct,
    choices: shuffle([
      { text: correct.meaning, ok: true },
      { text: w1.meaning,      ok: false },
      { text: w2.meaning,      ok: false }
    ])
  };
}

function safeResumeAudio(scene) {
  try { const c = scene.sound?.context; if (c?.state === "suspended") c.resume(); } catch(e) {}
}
function beep(scene, freq=880, dur=0.08, type="sine", vol=0.05) {
  try {
    const ctx = scene.sound?.context; if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch(e) {}
}

class GameScene extends Phaser.Scene {
  constructor() { super("game"); }

  create() {
    this.physics.world.setBounds(0, 0, W, H);

    this.roundId        = 0;
    this.roundFinished  = false;
    this.launched       = false;
    this.dragging       = false;
    this.skillUsed      = false;
    this.studyMode      = false;
    this.studyPreviewing = false;

    this.score         = 0;
    this.streak        = 0;
    this.questionCount = 0;
    this.level         = 1;
    this.levelQ        = 0;

    this.timeLeft    = 10;
    this.timerActive = false;

    // 7种鸟循环
    this.birdCycle = ["RED","BLUE","BLACK","GREEN","YELLOW","ORANGE","PURPLE"];
    this.birdIndex = -1;
    this.birdType  = "RED";

    this.MAX_PULL    = 240;
    this.POWER       = 16.0;
    this.GRAVITY_Y   = 420;
    this.DRAG_SMOOTH = 0.18;

    this.bgPalette = ["#bfe7ff","#d4f5d4","#fff3cd","#ffd6cc","#ffb3c6","#e8d5ff"];
    this.cameras.main.setBackgroundColor(this.bgPalette[0]);

    this.ground = this.add.rectangle(W/2, H-12, W, 24, 0x7ccf6a);
    this.physics.add.existing(this.ground, true);

    this.anchor = new Phaser.Math.Vector2(155, H-150);
    this.add.rectangle(this.anchor.x-18, this.anchor.y+45, 16, 90, 0x8b5a2b).setAngle(-6);
    this.add.rectangle(this.anchor.x+18, this.anchor.y+45, 16, 90, 0x8b5a2b).setAngle(6);

    this.bandGfx = this.add.graphics();
    this.trajGfx = this.add.graphics();

    this.makeTextures();

    this.blocks = this.physics.add.group();
    this.physics.add.collider(this.blocks, this.ground);
    this.physics.add.collider(this.blocks, this.blocks);
    this.birds   = this.physics.add.group();
    this.pigMeta = [];

    // UI
    this.wordText  = this.add.text(18, 10, "", { fontSize:"28px", color:"#1f2937", fontStyle:"bold" }).setDepth(5);
    this.levelText = this.add.text(18, 46, "", { fontSize:"14px", color:"#64748b" }).setDepth(5);
    this.tipText   = this.add.text(18, 64, "", { fontSize:"14px", color:"#475569" }).setDepth(5);
    this.scoreText = this.add.text(W-200, 10, "Score: 0",  { fontSize:"20px", color:"#1f2937" }).setDepth(5);
    this.streakText= this.add.text(W-200, 36, "",          { fontSize:"18px", color:"#f59e0b" }).setDepth(5);
    this.birdLabel = this.add.text(W-200, 60, "Bird: RED", { fontSize:"15px", color:"#64748b" }).setDepth(5);

    const TIMER_Y = 84;
    this.add.rectangle(W/2, TIMER_Y, W, 11, 0xdde1e7).setDepth(4);
    this.timerBar = this.add.rectangle(0, TIMER_Y, W, 11, 0x22c55e).setOrigin(0,0.5).setDepth(5);
    this.timerNum = this.add.text(W-5, TIMER_Y, "10", { fontSize:"12px", color:"#334155", fontStyle:"bold" }).setOrigin(1,0.5).setDepth(5);

    this.banner = this.add.text(W/2, 138, "", {
      fontSize:"52px", fontStyle:"bold", color:"#ffffff",
      stroke:"#1e293b", strokeThickness:8
    }).setOrigin(0.5).setAlpha(0).setDepth(12);

    this.revealBg    = this.add.rectangle(W/2, H/2, 540, 130, 0x0f172a, 0.94).setDepth(22).setAlpha(0);
    this.revealLine1 = this.add.text(W/2, H/2-24, "", {
      fontSize:"22px", fontStyle:"bold", color:"#fbbf24", align:"center", wordWrap:{width:510}
    }).setOrigin(0.5).setDepth(23).setAlpha(0);
    this.revealLine2 = this.add.text(W/2, H/2+20, "", {
      fontSize:"17px", color:"#e2e8f0", align:"center", wordWrap:{width:510}
    }).setOrigin(0.5).setDepth(23).setAlpha(0);

    this.makeButton(80, H-24, 120, 36, "⏭ 下一题", () => { safeResumeAudio(this); this.finishRoundAndNext(); });
    this.studyBtn = this.makeButton(215, H-24, 155, 36, "📚 学习模式 OFF", () => { safeResumeAudio(this); this.toggleStudyMode(); });

    this.input.on("pointerdown", () => {
      safeResumeAudio(this);
      if (!this.launched || this.roundFinished || this.dragging || this.skillUsed) return;
      this.useSkill();
    });

    this.bindDrag();
    this.newRound();
  }

  toggleStudyMode() {
    this.studyMode = !this.studyMode;
    this.studyBtn.lb.setText("📚 学习模式 " + (this.studyMode ? "ON ✓" : "OFF"));
    this.studyBtn.bg.setFillStyle(this.studyMode ? 0x0284c7 : 0x1e293b);
  }

  makeTextures() {
    if (this.textures.exists("wood")) return;
    let g = this.add.graphics();
    g.fillStyle(0xb7791f,1); g.fillRoundedRect(0,0,110,22,6);
    g.lineStyle(3,0x7a4a12,1); g.strokeRoundedRect(0,0,110,22,6);
    g.generateTexture("wood",110,22); g.destroy();
    g = this.add.graphics();
    g.fillStyle(0x94a3b8,1); g.fillRoundedRect(0,0,100,26,6);
    g.lineStyle(3,0x64748b,1); g.strokeRoundedRect(0,0,100,26,6);
    g.generateTexture("stone",100,26); g.destroy();
    g = this.add.graphics();
    g.fillStyle(0xffc24b,1); g.fillCircle(6,6,6);
    g.generateTexture("spark",12,12); g.destroy();
  }

  makeBirdContainer(x, y, type="RED") {
    const CFG = {
      RED:    { body:0xff3b3b, stroke:0xd41f1f, belly:0xffffff, brow:0x111827, beak:0xffc24b },
      BLUE:   { body:0x2f6bff, stroke:0x1e40af, belly:0xffffff, brow:0x111827, beak:0xffc24b },
      BLACK:  { body:0x111827, stroke:0x000000, belly:0x374151, brow:0x6b7280, beak:0xffc24b },
      GREEN:  { body:0x22c55e, stroke:0x15803d, belly:0xffffff, brow:0x14532d, beak:0xfbbf24 },
      YELLOW: { body:0xfbbf24, stroke:0xd97706, belly:0xffffff, brow:0x78350f, beak:0xef4444 },
      ORANGE: { body:0xf97316, stroke:0xc2410c, belly:0xffffff, brow:0x7c2d12, beak:0xfde047 },
      PURPLE: { body:0xa855f7, stroke:0x7e22ce, belly:0xffffff, brow:0x3b0764, beak:0xfcd34d },
    };
    const c = CFG[type] || CFG.RED;
    const size = type==="YELLOW" ? 28 : type==="ORANGE" ? 26 : 22; // 黄色最大，橙色略大

    const children = [
      this.add.circle(0,0,size,c.body).setStrokeStyle(3,c.stroke),
      this.add.ellipse(4,10,size-2,14,c.belly).setAlpha(0.65),
      this.add.circle(6,-6,10,0xffffff), this.add.circle(9,-6,4,0x111827),
      this.add.rectangle(6,-size-2,24,6,c.brow).setAngle(-10),
      this.add.triangle(14,4,0,0,18,6,0,12,c.beak).setStrokeStyle(2,0xeaa23b),
    ];

    // 各鸟特殊标记
    if (type==="GREEN") {
      // 闪电符号（速度鸟）
      children.push(this.add.text(-5,-4,"⚡",{fontSize:"13px"}).setOrigin(0.5));
    } else if (type==="YELLOW") {
      // 锤子符号（重锤鸟）
      children.push(this.add.text(-4,-4,"🔨",{fontSize:"13px"}).setOrigin(0.5));
    } else if (type==="ORANGE") {
      // 弹跳符号（弹跳鸟）
      children.push(this.add.text(-4,-4,"↺",{fontSize:"14px",color:"#ffffff",fontStyle:"bold"}).setOrigin(0.5));
    } else if (type==="PURPLE") {
      // 三叉符号（三分裂鸟）
      children.push(this.add.text(-5,-4,"✳",{fontSize:"13px",color:"#fde047"}).setOrigin(0.5));
    }

    const container = this.add.container(x, y, children);
    container.setSize(80,80);
    return container;
  }

  makePig(x, y) {
    const c = this.add.container(x, y, [
      this.add.circle(0,0,26,0x37c45a).setStrokeStyle(3,0x1f8a3d),
      this.add.ellipse(6,10,28,18,0x7ee38f).setStrokeStyle(2,0x2a9a47),
      this.add.circle(0,10,3,0x1f2937), this.add.circle(12,10,3,0x1f2937),
      this.add.circle(-8,-6,7,0xffffff), this.add.circle(-6,-6,3,0x111827),
      this.add.circle(8,-6,7,0xffffff),  this.add.circle(10,-6,3,0x111827)
    ]);
    c.setSize(80,80);
    return c;
  }

  makeButton(x, y, w, h, text, onClick) {
    const bg = this.add.rectangle(x,y,w,h,0x1e293b).setInteractive({useHandCursor:true}).setStrokeStyle(1,0x475569).setDepth(5);
    const lb = this.add.text(x,y,text,{fontSize:"14px",color:"#fff"}).setOrigin(0.5).setDepth(6);
    bg.on("pointerdown",()=>{ bg.setScale(0.96); onClick(); });
    bg.on("pointerup",  ()=>bg.setScale(1));
    bg.on("pointerover",()=>bg.setFillStyle(0x334155));
    bg.on("pointerout", ()=>{ bg.setScale(1); bg.setFillStyle(0x1e293b); });
    return {bg, lb};
  }

  lockBlocks(locked) {
    this.blocks.getChildren().forEach(b => {
      if (!b?.body) return;
      b.body.setAllowGravity(!locked);
      b.setImmovable(locked);
      if (locked) {
        b.body.setVelocity(0,0);
        if (typeof b.body.angularVelocity==="number") b.body.angularVelocity=0;
        else b.body.setAngularVelocity?.(0);
      }
    });
  }

  spawnLevelBlocks() {
    // ── 设计原则 ──────────────────────────────────────────
    // 1. 块只堆最多2层（top center y ≤ H-45），永远不形成高墙
    // 2. x 范围 510-650，猪在 x=720，留出 70px 以上视野空间
    // 3. 每两堆之间有明显间隙（≥60px），保证上/中/下三条飞行路线畅通
    // 4. 随关卡增加块数，但结构依然通透
    const lv = Math.min(this.level, 6);
    const H  = this.scale.height;

    // 每关预设的块布局 [x, y_center, type]
    // y_center: H-23 = 地面层, H-46 = 第二层（顶部 H-57，不遮挡任何飞行路线）
    const B = [H-23, H-46]; // 层0,层1 的中心 y

    const layouts = [
      // 第1关：2块散落，宽间距，完全开放
      [[535, B[0],"wood"], [640, B[0],"wood"]],

      // 第2关：一堆2层 + 一块单独
      [[530, B[0],"wood"], [530, B[1],"stone"],
       [645, B[0],"stone"]],

      // 第3关：两堆2层，中间留大缺口
      [[520, B[0],"stone"], [520, B[1],"wood"],
       [630, B[0],"wood"],  [630, B[1],"stone"]],

      // 第4关：两堆2层 + 两块散落，呈W形，三条通道清晰
      [[515, B[0],"wood"],  [515, B[1],"stone"],
       [575, B[0],"stone"],
       [635, B[0],"wood"],  [635, B[1],"wood"],
       [610, B[0],"stone"]],

      // 第5关：三堆错落，间隙略窄但仍有缺口
      [[510, B[0],"stone"], [510, B[1],"wood"],
       [565, B[0],"wood"],  [565, B[1],"stone"],
       [625, B[0],"stone"], [625, B[1],"wood"]],

      // 第6关+：最密但每堆只有2层，仍然可攻
      [[505, B[0],"wood"],  [505, B[1],"stone"],
       [555, B[0],"stone"], [555, B[1],"wood"],
       [608, B[0],"wood"],  [608, B[1],"stone"],
       [658, B[0],"stone"]],
    ];

    const layout = layouts[lv - 1] || layouts[layouts.length-1];
    layout.forEach(([x, y, type]) => {
      const b = this.blocks.create(x, y, type);
      if (type === "wood") b.setBounce(0.02).setDrag(0.92,0.92).setMass(2);
      else                 b.setBounce(0.01).setDrag(0.90,0.90).setMass(3.2);
      b.setCollideWorldBounds(true);
    });
    this.lockBlocks(true);
  }

  spawnMainBird() {
    this.birds.clear(true, true);
    const bird = this.makeBirdContainer(this.anchor.x, this.anchor.y, this.birdType);
    this.physics.add.existing(bird);

    // 不同鸟的碰撞半径和物理属性
    const radius = this.birdType==="YELLOW" ? 28 : this.birdType==="ORANGE" ? 26 : 22;
    bird.body.setCircle(radius, -radius, -radius)
      .setCollideWorldBounds(true).setBounce(0.45).setDrag(0.35,0.35).setAllowGravity(false);

    // ORANGE 初始就高弹性（发射前），GREEN 有更高速度（通过POWER控制）
    if (this.birdType === "ORANGE") bird.body.setBounce(0.55);

    this.physics.add.collider(bird, this.ground);
    this.physics.add.collider(bird, this.blocks);
    bird.setInteractive(new Phaser.Geom.Circle(0,0,90), Phaser.Geom.Circle.Contains);
    this.input.setDraggable(bird);
    this.bird = bird;
    this.birds.add(bird);
  }

  resetBird() {
    this.skillUsed = false;
    this.bandGfx.clear(); this.trajGfx.clear();
    this.spawnMainBird();
    this.bird.x = this.anchor.x; this.bird.y = this.anchor.y;
    this.bird.body.setVelocity(0,0).setAllowGravity(false).setGravityY(0);
    this.bird.body.moves = true;
  }

  bindDrag() {
    if (this._dragBound) return;
    this._dragBound = true;
    this.input.on("dragstart", () => {
      if (this.roundFinished || this.launched || this.studyPreviewing) return;
      safeResumeAudio(this);
      this.dragging = true;
      this.bird.body.setVelocity(0,0).setAllowGravity(false);
      this.bird.body.moves = false;
      beep(this, 520, 0.05, "sine", 0.03);
    });
    this.input.on("drag", (pointer, obj, dragX, dragY) => {
      if (!this.dragging || this.roundFinished || this.launched) return;
      const nx = Phaser.Math.Linear(obj.x, dragX, 1-this.DRAG_SMOOTH);
      const ny = Phaser.Math.Linear(obj.y, dragY, 1-this.DRAG_SMOOTH);
      const v  = new Phaser.Math.Vector2(nx-this.anchor.x, ny-this.anchor.y);
      if (v.length() > this.MAX_PULL) v.setLength(this.MAX_PULL);
      obj.x = this.anchor.x + v.x; obj.y = this.anchor.y + v.y;
      this.drawBandAndTrajectory(obj.x, obj.y);
    });
    this.input.on("dragend", () => {
      if (!this.dragging || this.roundFinished || this.launched) return;
      this.dragging = false;
      const pull = new Phaser.Math.Vector2(this.bird.x-this.anchor.x, this.bird.y-this.anchor.y);
      // GREEN鸟发射速度 1.5×
      const speedMult = this.birdType === "GREEN" ? 1.5 : 1.0;
      const vel  = pull.clone().scale(-this.POWER * speedMult);
      this.lockBlocks(false);
      this.bird.body.moves = true;
      this.bird.body.setAllowGravity(true).setGravityY(this.GRAVITY_Y);
      this.bird.body.setVelocity(vel.x, vel.y);
      this.launched = true;
      this.bandGfx.clear(); this.trajGfx.clear();
      this.stopTimer();
      const myRound = this.roundId;
      this.time.delayedCall(4500, () => {
        if (this.roundId!==myRound || this.roundFinished) return;
        this.onChoose(false, W/2, H/2, null);
      });
      beep(this, 780, 0.06, "square", 0.05);
    });
  }

  startTimer() {
    if (this.timerActive) return;
    this.timerActive = true;
    this.timeLeft    = 10;
    this.updateTimerVisual();
    this.timerEvent = this.time.addEvent({
      delay:1000, repeat:9,
      callback: () => {
        if (!this.timerActive) return;
        this.timeLeft = Math.max(0, this.timeLeft-1);
        this.updateTimerVisual();
        if (this.timeLeft <= 3 && this.timeLeft > 0) beep(this, 440, 0.05, "square", 0.03);
        if (this.timeLeft === 0 && !this.launched && !this.roundFinished) {
          this.timerActive = false;
          this.showBanner("⏰ 超时！", "#64748b");
          this.time.delayedCall(300, () => this.onChoose(false, W/2, H/2, null));
        }
      }
    });
  }

  stopTimer() {
    this.timerActive = false;
    if (this.timerEvent) { this.timerEvent.remove(); this.timerEvent = null; }
    this.timerBar.width = W;
    this.timerBar.setFillStyle(0x22c55e);
    this.timerNum.setText("--");
  }

  updateTimerVisual() {
    const pct = this.timeLeft / 10;
    this.timerBar.width = W * Math.max(0, pct);
    this.timerNum.setText(this.timeLeft > 0 ? String(this.timeLeft) : "0");
    this.timerBar.setFillStyle(pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444);
  }

  drawBandAndTrajectory(x, y) {
    this.bandGfx.clear(); this.trajGfx.clear();
    this.bandGfx.lineStyle(7, 0x5b2d0a, 0.45);
    this.bandGfx.beginPath(); this.bandGfx.moveTo(this.anchor.x, this.anchor.y);
    this.bandGfx.lineTo(x, y); this.bandGfx.strokePath();
    const v0 = new Phaser.Math.Vector2(x-this.anchor.x, y-this.anchor.y).scale(-this.POWER);
    const g  = this.GRAVITY_Y;
    this.trajGfx.fillStyle(0x1e293b, 0.18);
    for (let i=1; i<=28; i++) {
      const t=i*0.075, px=x+v0.x*t, py=y+v0.y*t+0.5*g*t*t;
      if (px<0||px>W||py<0||py>H) break;
      this.trajGfx.fillCircle(px, py, 4);
    }
  }

  useSkill() {
    this.skillUsed = true;
    const vx = this.bird?.body?.velocity?.x ?? 0;
    const vy = this.bird?.body?.velocity?.y ?? 0;
    const bx = this.bird?.x ?? 0;
    const by = this.bird?.y ?? 0;

    if (this.birdType === "BLUE") {
      // 二分裂
      beep(this, 980, 0.06, "sine", 0.05);
      [-130,+130].forEach(dvy => {
        const b = this.makeBirdContainer(bx, by, "BLUE");
        this.physics.add.existing(b);
        b.body.setCircle(18,-18,-18).setCollideWorldBounds(true).setBounce(0.45)
          .setDrag(0.35,0.35).setAllowGravity(true).setGravityY(this.GRAVITY_Y);
        b.body.setVelocity(vx, vy+dvy);
        this.physics.add.collider(b, this.ground);
        this.physics.add.collider(b, this.blocks);
        this.birds.add(b);
      });
      this.showBanner("✂ BLUE SPLIT!", "#1d4ed8");

    } else if (this.birdType === "BLACK") {
      // 爆炸
      beep(this, 180, 0.10, "sawtooth", 0.06);
      this.doExplode(bx, by, 175);
      this.showBanner("💥 BOOM!", "#b91c1c");
      this.bird.destroy();

    } else if (this.birdType === "GREEN") {
      // 速度爆发：瞬间加速 1.8×
      beep(this, 1200, 0.06, "square", 0.04);
      this.bird.body.setVelocity(vx * 1.8, vy * 1.3);
      // 拖尾闪光
      const trail = this.add.circle(bx, by, 16, 0x86efac, 0.7);
      this.tweens.add({ targets:trail, alpha:0, scale:2.2, duration:280, onComplete:()=>trail.destroy() });
      this.showBanner("⚡ SPEED BOOST!", "#15803d");

    } else if (this.birdType === "YELLOW") {
      // 重力砸：瞬间下坠（无水平速度减损，竖向速度变最大）
      beep(this, 300, 0.08, "sawtooth", 0.05);
      this.bird.body.setVelocity(vx * 0.3, 680);
      this.bird.body.setGravityY(this.GRAVITY_Y * 2);
      this.cameras.main.shake(60, 0.006);
      this.showBanner("🔨 GROUND SMASH!", "#d97706");

    } else if (this.birdType === "ORANGE") {
      // 超级弹跳：把弹性调到 0.95，滚动碰几次都不停
      beep(this, 650, 0.07, "sine", 0.05);
      this.bird.body.setBounce(0.92);
      this.bird.body.setDrag(0.05, 0.05);
      this.showBanner("↺ SUPER BOUNCE!", "#c2410c");

    } else if (this.birdType === "PURPLE") {
      // 三分裂：向上/平/向下
      beep(this, 1050, 0.07, "sine", 0.05);
      [-160, 0, +160].forEach(dvy => {
        const b = this.makeBirdContainer(bx, by, "PURPLE");
        this.physics.add.existing(b);
        b.body.setCircle(18,-18,-18).setCollideWorldBounds(true).setBounce(0.45)
          .setDrag(0.35,0.35).setAllowGravity(true).setGravityY(this.GRAVITY_Y);
        b.body.setVelocity(vx * 0.9, vy + dvy);
        this.physics.add.collider(b, this.ground);
        this.physics.add.collider(b, this.blocks);
        this.birds.add(b);
      });
      this.bird.destroy();
      this.showBanner("✳ TRIPLE SPLIT!", "#7e22ce");

    } else {
      // RED：无技能
      this.showBanner("RED: 无技能", "#6b7280");
    }
  }

  doExplode(x, y, radius=150) {
    try {
      this.cameras.main.shake(150, 0.013);
      const p = this.add.particles(x, y, "spark", {
        speed:{min:130,max:550}, angle:{min:0,max:360},
        scale:{start:1.1,end:0}, lifespan:550, quantity:30
      });
      this.time.delayedCall(560, ()=>{ try{p.destroy();}catch(e){} });
      this.blocks.getChildren().forEach(b => {
        if (!b?.body) return;
        const dx=b.x-x, dy=b.y-y, dist=Math.max(60,Math.sqrt(dx*dx+dy*dy));
        if (dist>radius) return;
        const f=(radius*65)/dist;
        b.body.velocity.x+=(dx/dist)*f; b.body.velocity.y+=(dy/dist)*f;
        const av=Math.random()*130-65;
        if (typeof b.body.angularVelocity==="number") b.body.angularVelocity+=av;
        else b.body.setAngularVelocity?.(av);
      });
      if (!this.roundFinished) {
        let best=null, bestD=1e9;
        this.pigMeta.forEach(pm => {
          if (!pm.alive) return;
          const d=Phaser.Math.Distance.Between(pm.pig.x, pm.pig.y, x, y);
          if (d<bestD && d<=radius) { bestD=d; best=pm; }
        });
        if (best) { best.alive=false; this.onChoose(best.ok, best.pig.x, best.pig.y, best); }
      }
    } catch(err) { console.error("explode:", err); }
  }

  newRound() {
    this.roundId++;
    this.roundFinished   = false;
    this.launched        = false;
    this.dragging        = false;
    this.skillUsed       = false;
    this.studyPreviewing = false;
    this.stopTimer();

    this.blocks.clear(true, true);
    this.pigMeta.forEach(p => {
      p.pig?.destroy(); p.label?.destroy(); p.bubble?.destroy(); p.moveTween?.stop();
    });
    this.pigMeta = [];

    this.birdIndex = (this.birdIndex+1) % this.birdCycle.length;
    this.birdType  = this.birdCycle[this.birdIndex];
    const BIRD_HINTS = {
      RED:"🔴 普通鸟（无技能）", BLUE:"🔵 二分裂（飞行中点击）",
      BLACK:"⚫ 爆炸（飞行中点击）", GREEN:"🟢 速度爆发（飞行中点击）",
      YELLOW:"🟡 重力砸（飞行中点击）", ORANGE:"🟠 超级弹跳（飞行中点击）",
      PURPLE:"🟣 三分裂（飞行中点击）"
    };
    this.birdLabel.setText(BIRD_HINTS[this.birdType] || this.birdType);

    this.levelQ++;
    if (this.levelQ > 5) {
      this.levelQ = 1; this.level++;
      this.showBanner("🎉 LEVEL " + this.level + "!", "#f59e0b");
    }
    // 复仇池状态文字
    const imCount  = REVENGE_POOL.filter(r => r.immediate > 0).length;
    const spCount  = REVENGE_POOL.filter(r => r.immediate === 0).length;
    let revengeInfo = "";
    if (imCount > 0)       revengeInfo = `  ⚡立即复习:${imCount}词`;
    else if (spCount > 0)  revengeInfo = `  🔁待复习:${spCount}词`;
    this.levelText.setText("第" + this.level + "关  Q" + this.levelQ + "/5" + revengeInfo);
    this.tipText.setText("拖鸟→发射，物理击中正确答案的猪！  飞行中点击=技能");

    this.spawnLevelBlocks();
    this.q = makeQuestion();

    if (this.studyMode) {
      this.studyPreviewing = true;
      this.wordText.setText("📖 " + this.q.correct.word + "  →  " + this.q.correct.meaning);
      this.tipText.setText("📚 学习预览 2秒后开始...");
      this.resetBird();
      this.time.delayedCall(2000, () => {
        if (!this.studyPreviewing) return;
        this.studyPreviewing = false;
        this.wordText.setText("WORD: " + this.q.correct.word);
        this.tipText.setText("拖鸟→发射，物理击中正确答案的猪！  飞行中点击=技能");
        this.spawnPigs();
        this.startTimer();
      });
    } else {
      this.wordText.setText("WORD: " + this.q.correct.word);
      this.spawnPigs();
      this.resetBird();
      this.startTimer();
    }
  }

  spawnPigs() {
    const pigX   = 715;
    const ys     = [175, 325, 460];
    const moving = this.level >= 3;

    this.q.choices.forEach((c, i) => {
      const y = ys[i];
      const pig = this.makePig(pigX, y);
      const bubW = 220, bubH = 60;
      const bubble = this.add.rectangle(pigX, y-56, bubW, bubH, 0xfffef0, 0.95).setStrokeStyle(2, 0xfcd34d);
      const label  = this.add.text(pigX, y-56, c.text, {
        fontSize:"14px", color:"#1e293b", align:"center",
        wordWrap:{width:bubW-16, useAdvancedWrap:true}
      }).setOrigin(0.5);

      this.tweens.add({ targets:pig, scaleY:0.92, duration:500+i*80, yoyo:true, repeat:-1, ease:"Sine.easeInOut" });

      let moveTween = null;
      if (moving) {
        const range = 40 + i * 12;
        moveTween = this.tweens.add({
          targets:[pig, bubble, label], x:"+=" + range,
          duration:900+i*240, yoyo:true, repeat:-1, ease:"Sine.easeInOut"
        });
      }
      this.pigMeta.push({ pig, label, bubble, ok:c.ok, alive:true, moveTween });
    });
  }

  update() {
    if (this.roundFinished || !this.launched) return;
    this.birds.getChildren().forEach(birdObj => {
      if (!birdObj?.active) return;
      this.pigMeta.forEach(pm => {
        if (!pm.alive) return;
        if (Phaser.Math.Distance.Between(birdObj.x, birdObj.y, pm.pig.x, pm.pig.y) < 50) {
          pm.alive = false;
          this.onChoose(pm.ok, pm.pig.x, pm.pig.y, pm);
        }
      });
    });
  }

  onChoose(ok, hitX, hitY, pm) {
    if (this.roundFinished) return;
    this.roundFinished = true;
    this.stopTimer();
    this.cameras.main.shake(80, 0.006);

    if (ok) {
      this.streak++;
      this.questionCount++;
      const add = 10 + Math.min(20, this.streak * 2);
      this.score += add;
      this.scoreText.setText("Score: " + this.score);
      this.updateStreakDisplay();

      if (pm?.pig) this.pigFlyOff(pm);

      let txt="✅ CORRECT!", col="#065f46";
      if (this.streak >= 8)      { txt="🏆 PERFECT!!!";           col="#7c3aed"; }
      else if (this.streak >= 5) { txt="⚡ COMBO ×"+this.streak+"!"; col="#dc2626"; }
      else if (this.streak >= 3) { txt="🎯 NICE SHOT!";            col="#d97706"; }
      else if (this.streak >= 2) { txt="✅ ×"+this.streak+" 连击"; col="#0369a1"; }

      this.showBanner(txt, col);
      this.tipText.setText("✅ +" + add + "  连击 ×" + this.streak);
      this.cameras.main.setBackgroundColor(this.bgPalette[Math.min(Math.floor(this.streak/2), this.bgPalette.length-1)]);

      beep(this, 920, 0.09, "sine", 0.06);
      if (this.streak >= 3) beep(this, 1100+this.streak*40, 0.06, "sine", 0.04);

      const myRound = this.roundId;
      this.time.delayedCall(1100, () => { if (this.roundId===myRound) this.finishRoundAndNext(); });
    } else {
      this.streak = 0;
      this.cameras.main.setBackgroundColor(this.bgPalette[0]);
      this.updateStreakDisplay();
      if (this.launched && this.bird?.body) this.birdBounceBack();
      this.tipText.setText("❌ 答错了！看正确答案...");
      this.showBanner("❌ WRONG!", "#991b1b");
      beep(this, 220, 0.14, "sawtooth", 0.06);

      const w = this.q.correct;
      addToRevenge(w);   // 加入间隔重复：立即×2，之后每5题×1，共7次
      this.showReveal(w.word, w.meaning);

      const myRound = this.roundId;
      this.time.delayedCall(2700, () => { if (this.roundId===myRound) this.finishRoundAndNext(); });
    }
  }

  pigFlyOff(pm) {
    if (!pm?.pig) return;
    const flash = this.add.circle(pm.pig.x, pm.pig.y, 34, 0xffffff, 0.85);
    this.tweens.add({ targets:flash, alpha:0, scale:2.5, duration:220, onComplete:()=>flash.destroy() });
    try {
      const p = this.add.particles(pm.pig.x, pm.pig.y, "spark", {
        speed:{min:100,max:420}, angle:{min:0,max:360},
        scale:{start:1.2,end:0}, lifespan:480, quantity:22
      });
      this.time.delayedCall(500, ()=>{ try{p.destroy();}catch(e){} });
    } catch(e) {}
    const dir = Phaser.Math.Between(0,1) ? 300 : -300;
    this.tweens.add({
      targets:pm.pig, x:pm.pig.x+dir, y:-100, angle:720,
      scaleX:0.05, scaleY:0.05, duration:600, ease:"Back.easeIn",
      onComplete:()=>{ try{pm.pig.destroy();}catch(e){} }
    });
    [pm.bubble, pm.label].forEach(o => { if (!o) return; this.tweens.add({ targets:o, alpha:0, duration:200 }); });
  }

  birdBounceBack() {
    if (!this.bird?.body) return;
    const vx=this.bird.body.velocity.x, vy=this.bird.body.velocity.y;
    this.bird.body.setVelocity(-Math.abs(vx)*2.5, Math.min(-60, vy*0.3-80));
    this.tweens.add({ targets:this.bird, angle:720, duration:450, repeat:1, ease:"Linear" });
    this.time.delayedCall(500, () => {
      const ouch = this.add.text(this.anchor.x+20, this.anchor.y-55, "OUCH! 😵", {
        fontSize:"26px", fontStyle:"bold", color:"#dc2626", stroke:"#ffffff", strokeThickness:4
      }).setOrigin(0.5).setDepth(15);
      this.tweens.add({ targets:ouch, y:ouch.y-45, alpha:0, duration:900, ease:"Cubic.easeOut", onComplete:()=>ouch.destroy() });
      this.cameras.main.shake(80, 0.008);
      beep(this, 160, 0.08, "sawtooth", 0.05);
    });
  }

  showReveal(word, meaning) {
    this.revealLine1.setText("✓ 正确答案：" + word);
    this.revealLine2.setText(meaning.length>55 ? meaning.slice(0,55)+"…" : meaning);
    this.tweens.add({ targets:[this.revealBg, this.revealLine1, this.revealLine2], alpha:1, duration:200 });
    this.time.delayedCall(2100, () => {
      this.tweens.add({ targets:[this.revealBg, this.revealLine1, this.revealLine2], alpha:0, duration:350 });
    });
  }

  showBanner(text, color="#111827") {
    this.banner.setText(text).setColor(color).setAlpha(1).setScale(0.8);
    this.tweens.add({ targets:this.banner, scale:1.08, duration:120, yoyo:true });
    this.tweens.add({
      targets:this.banner, alpha:0, y:108, duration:750, delay:550,
      onComplete:()=>{ this.banner.y=138; }
    });
  }

  updateStreakDisplay() {
    if (this.streak >= 8)      this.streakText.setText("🔥🔥 ×"+this.streak).setColor("#a855f7");
    else if (this.streak >= 5) this.streakText.setText("🔥 ×"+this.streak).setColor("#ef4444");
    else if (this.streak >= 2) this.streakText.setText("⚡ ×"+this.streak).setColor("#f59e0b");
    else                       this.streakText.setText("");
  }

  finishRoundAndNext() {
    this.bandGfx.clear(); this.trajGfx.clear();
    this.newRound();
  }
}

const config = {
  type: Phaser.AUTO,
  width: W, height: H,
  parent: "wrap",
  physics: { default:"arcade", arcade:{ gravity:{y:0}, debug:false } },
  scene: [GameScene]
};

new Phaser.Game(config);