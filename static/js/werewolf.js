// ============================================================================
// AI 狼人杀 - 完整重写版
// 特性：每环节AI发言、投票展示、按身份配置API
// ============================================================================

// ========== 角色定义 ==========
const ROLES = {
    werewolf: { id:'werewolf', name:'狼人', emoji:'🐺', team:'wolf',    tagClass:'wolf',    desc:'每晚可以刀杀一名玩家' },
    villager: { id:'villager', name:'村民', emoji:'👤', team:'village', tagClass:'villager', desc:'白天参与投票放逐' },
    seer:     { id:'seer',     name:'预言家', emoji:'🔮', team:'village', tagClass:'seer',     desc:'每晚查验一名玩家身份' },
    witch:    { id:'witch',    name:'女巫', emoji:'🧪', team:'village', tagClass:'witch',    desc:'拥有解药(救)和毒药(杀)' },
    hunter:   { id:'hunter',   name:'猎人', emoji:'🏹', team:'village', tagClass:'hunter',   desc:'出局时可开枪带走一人' },
    guard:    { id:'guard',    name:'守卫', emoji:'🛡️', team:'village', tagClass:'guard',    desc:'每晚守护一名玩家免于刀杀' },
};

// ========== 预设方案 ==========
const PRESETS = {
    beginner:  { name:'新手局(6人)',  roles:['werewolf','werewolf','seer','witch','villager','villager'] },
    standard:  { name:'标准局(9人)',  roles:['werewolf','werewolf','werewolf','seer','witch','hunter','villager','villager','villager'] },
    advanced:  { name:'进阶局(12人)', roles:['werewolf','werewolf','werewolf','werewolf','seer','witch','hunter','guard','villager','villager','villager','villager'] },
};

// ========== 全局 API 配置（从 api_providers.json 读取）==========
let wwGlobalProviders = [];   // 启用的、有 chat_models 的 provider 列表

// ========== 每个身份的默认配置 ==========
const DEFAULT_ROLE_CONFIG = {
    providerId: '',
    model: '',
    enabled: false
};

// ========== 按身份独立 API 配置 ==========
let roleConfigs = {
    werewolf: { ...DEFAULT_ROLE_CONFIG },
    villager: { ...DEFAULT_ROLE_CONFIG },
    seer: { ...DEFAULT_ROLE_CONFIG },
    witch: { ...DEFAULT_ROLE_CONFIG },
    hunter: { ...DEFAULT_ROLE_CONFIG },
    guard: { ...DEFAULT_ROLE_CONFIG },
};

// ========== 游戏设置（持久化）==========
let gameSettings = {
    autoMode: false
};

// ========== 全局游戏状态 ==========
let gameState = {
    phase: 'setup',        // setup | night-wolf-speak | night-wolf-vote | night-seer-speak | night-seer-check | night-witch-speak | night-witch-act | night-guard-speak | night-guard-act | night-resolve | day-announce | day-speak | day-vote | day-result | day-lastwords | game-over
    day: 1,
    players: [],           // { id, name, role, alive, avatar, ... }
    speeches: [],          // { playerId, playerName, role, content, time }
    votes: {},             // { voterId: targetId }
    voteTally: {},         // { targetId: count }
    log: [],
    // 夜晚状态
    wolfTarget: null,
    wolfVotes: {},         // { wolfPlayerId: targetId }
    seerTarget: null,
    seerResult: null,
    witchSaveUsed: false,
    witchPoisonUsed: false,
    witchSavedTarget: null,
    witchPoisonTarget: null,
    guardTarget: null,
    guardLastTarget: null,
    nightDeaths: [],
    // 白天状态
    currentSpeakerIdx: 0,
    exiledPlayerId: null,
    exiledVoteTally: null, // 保存投票明细用于展示
    winner: null,
    gameOver: false,
    activePreset: null,
    playerCounter: 1,
};

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', () => {
    loadRoleConfigs();
    loadGameSettings();
    fetchGlobalProviders().then(() => renderSetupPanel());
    updateThemeVars();
});

function loadGameSettings(){
    try {
        const saved = localStorage.getItem('werewolf_gameSettings');
        if(saved){
            const parsed = JSON.parse(saved);
            gameSettings.autoMode = typeof parsed.autoMode === 'boolean' ? parsed.autoMode : false;
        }
    } catch(e){}
    const toggle = document.getElementById('autoModeToggle');
    if(toggle) toggle.checked = gameSettings.autoMode;
}

function toggleAutoMode(val){
    gameSettings.autoMode = val;
    localStorage.setItem('werewolf_gameSettings', JSON.stringify(gameSettings));
}

function updateThemeVars(){
    try{
        const t = localStorage.getItem('studio_theme')||localStorage.getItem('canvas_theme')||'light';
        if(t==='dark'){ document.documentElement.classList.add('studio-theme-dark','theme-dark'); }
    }catch(e){}
}

// ============================================================================
// 设置面板
// ============================================================================
function renderSetupPanel(){
    gameState.phase = 'setup';
    document.getElementById('setupPanel').style.display = 'block';
    document.getElementById('gamePanel').style.display = 'none';
    updateBadge('setup','游戏设置');
    renderApiConfig();
}

// ========== 获取全局 providers ==========
async function fetchGlobalProviders(){
    try {
        const resp = await fetch('/api/providers');
        const data = await resp.json();
        const all = data.providers || [];
        wwGlobalProviders = all.filter(p => 
            p.enabled !== false && 
            Array.isArray(p.chat_models) && p.chat_models.length > 0 &&
            p.id !== 'modelscope'
        );
    } catch(e){
        console.warn('加载全局 API 配置失败:', e);
        wwGlobalProviders = [];
    }
}

// ========== API 配置持久化 ==========
function loadRoleConfigs(){
    const saved = localStorage.getItem('werewolf_roleConfigs');
    if(!saved) return;
    try {
        const parsed = JSON.parse(saved);
        Object.keys(roleConfigs).forEach(rid => {
            if(parsed[rid]){
                roleConfigs[rid].providerId = parsed[rid].providerId || '';
                roleConfigs[rid].model = parsed[rid].model || '';
                roleConfigs[rid].enabled = typeof parsed[rid].enabled === 'boolean' ? parsed[rid].enabled : false;
            }
        });
    } catch(e){
        console.warn('加载 API 配置失败:', e);
    }
}

function saveRoleConfigs(){
    localStorage.setItem('werewolf_roleConfigs', JSON.stringify(roleConfigs));
}

// ========== 渲染 API 配置 UI（每个身份一张卡片）==========
function renderApiConfig(){
    const container = document.getElementById('apiConfigArea');
    if(!container) return;

    if(wwGlobalProviders.length === 0){
        container.innerHTML = `<div style="font-size:13px;color:var(--danger);padding:8px 0;">
            未检测到已配置且启用 chat_models 的全局 API 平台。<br/>
            请先在<a href="/api-setting" style="color:var(--accent);text-decoration:underline;">API 设置</a>中添加并启用平台（如 DeepSeek、火山引擎等）。
        </div>`;
        return;
    }

    const roleIds = ['werewolf','seer','witch','hunter','guard','villager'];

    container.innerHTML = '<div class="ww-role-list">' + roleIds.map(rid => {
        const role = ROLES[rid];
        const cfg = roleConfigs[rid];
        const selProv = wwGlobalProviders.find(p => p.id === cfg.providerId);
        const curProv = selProv || wwGlobalProviders[0];
        const curModel = cfg.model || (curProv.chat_models && curProv.chat_models[0]) || '';
        const models = curProv.chat_models || [];

        return `
        <div class="ww-role-config">
            <div class="ww-role-header">
                <span class="ww-role-icon">${role.emoji}</span>
                <span class="ww-role-name">${role.name}</span>
                <span style="font-size:11px;color:var(--muted);margin-left:4px;">${role.desc}</span>
            </div>
            <div class="ww-role-fields">
                <div class="ww-role-field-row">
                    <span class="ww-role-field-label">平台</span>
                    <select class="ww-select" onchange="onRoleProviderChange('${rid}', this.value)">
                        ${wwGlobalProviders.map(p => 
                            `<option value="${p.id}" ${p.id === curProv.id ? 'selected' : ''}>${esc(p.name || p.id)}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="ww-role-field-row">
                    <span class="ww-role-field-label">模型</span>
                    <select class="ww-select" onchange="onRoleModelChange('${rid}', this.value)">
                        ${models.map(m => 
                            `<option value="${esc(m)}" ${m === curModel ? 'selected' : ''}>${esc(m)}</option>`
                        ).join('')}
                    </select>
                </div>
                <label class="ww-checkbox-label">
                    <input type="checkbox" ${cfg.enabled ? 'checked' : ''} onchange="onRoleEnabledChange('${rid}', this.checked)" />
                    启用 API（关闭则使用本地随机决策）
                </label>
            </div>
        </div>`;
    }).join('') + '</div>';
}

function onRoleProviderChange(rid, providerId){
    roleConfigs[rid].providerId = providerId;
    const provider = wwGlobalProviders.find(p => p.id === providerId);
    if(provider && provider.chat_models && provider.chat_models.length > 0){
        roleConfigs[rid].model = provider.chat_models[0];
    } else {
        roleConfigs[rid].model = '';
    }
    saveRoleConfigs();
    renderApiConfig();
}

function onRoleModelChange(rid, modelName){
    roleConfigs[rid].model = modelName;
    saveRoleConfigs();
}

function onRoleEnabledChange(rid, val){
    roleConfigs[rid].enabled = val;
    saveRoleConfigs();
}

// ========== 预设方案 ==========
let roleCount = {};  // { werewolf: 2, seer: 1, ... }

function applyPreset(type){
    const preset = PRESETS[type];
    if(!preset) return;
    gameState.activePreset = type;
    // 重置计数
    roleCount = {};
    Object.keys(ROLES).forEach(rid=>{ roleCount[rid]=0; });
    // 统计
    preset.roles.forEach(rid=>{ roleCount[rid]++; });
    addLog('system', `已加载预设方案：${preset.name}`);
    // 高亮卡片
    document.querySelectorAll('.ww-preset-card').forEach(c=>c.classList.remove('active'));
    const activeCard = document.querySelector(`.ww-preset-card[data-preset="${type}"]`);
    if(activeCard) activeCard.classList.add('active');
}

// ============================================================================
// 游戏启动
// ============================================================================
function startGame(){
    clearError();
    // 验证
    const total = Object.values(roleCount).reduce((s,c)=>s+c,0);
    if(total < 6){
        showError(`至少需要 6 名玩家，当前共 ${total} 名`);
        return;
    }
    const wolfCount = roleCount.werewolf || 0;
    if(wolfCount===0){ showError('至少需要 1 名狼人'); return; }
    if(!roleCount.seer){ showError('至少需要 1 名预言家'); return; }
    if(!roleCount.villager){ showError('至少需要 1 名村民'); return; }
    if(wolfCount >= total - wolfCount){ showError('狼人数量过多（应少于总玩家数的一半）'); return; }

    // 生成玩家
    gameState.players = [];
    gameState.playerCounter = 1;
    const preset = PRESETS[gameState.activePreset] || PRESETS.standard;
    preset.roles.forEach((rid,i)=>{
        const role = ROLES[rid];
        const p = {
            id: 'player_'+Date.now()+'_'+gameState.playerCounter,
            name: role.name+' '+gameState.playerCounter,
            displayNum: gameState.playerCounter,
            role: rid,
            alive: true,
            avatar: (gameState.playerCounter%10).toString(),
        };
        gameState.players.push(p);
        gameState.playerCounter++;
    });

    // 初始化游戏状态
    gameState.day = 1;
    gameState.phase = 'night-wolf-speak';
    gameState.speeches = [];
    gameState.votes = {};
    gameState.voteTally = {};
    gameState.log = [];
    gameState.winner = null;
    gameState.gameOver = false;
    gameState.nightDeaths = [];
    gameState.wolfTarget = null;
    gameState.seerTarget = null;
    gameState.seerResult = null;
    gameState.witchSavedTarget = null;
    gameState.witchPoisonTarget = null;
    gameState.guardTarget = null;
    gameState.guardLastTarget = null;
    gameState.witchSaveUsed = false;
    gameState.witchPoisonUsed = false;
    gameState.exiledPlayerId = null;
    gameState.exiledVoteTally = null;

    // 切换面板
    document.getElementById('setupPanel').style.display = 'none';
    document.getElementById('gamePanel').style.display = 'flex';

    addLog('system','══════════ 游戏开始 ══════════');
    addLog('system',`共 ${gameState.players.length} 名玩家`);
    const roleSummary = Object.entries(roleCount).filter(([_,c])=>c>0).map(([rid,c])=>ROLES[rid].emoji+' '+ROLES[rid].name+'×'+c).join(' · ');
    addLog('system', roleSummary);

    // 初始化自动模式
    gameState.autoMode = gameSettings.autoMode;
    if(gameSettings.autoMode){
        addLog('system','🤖 自动模式已开启，AI 将自动推进游戏流程');
    }

    // 更新顶栏
    updateGameTopbar();
    enterNightPhase();
}

function updateGameTopbar(){
    const dayEl = document.getElementById('gameTopbarDay');
    const phaseEl = document.getElementById('gameTopbarPhase');
    const rolesEl = document.getElementById('gameTopbarRoles');
    if(dayEl) dayEl.textContent = '第 '+gameState.day+' 天';
    if(rolesEl){
        const parts = [];
        if(roleCount.werewolf) parts.push(roleCount.werewolf+'狼');
        if(roleCount.seer)     parts.push(roleCount.seer+'预');
        if(roleCount.witch)    parts.push(roleCount.witch+'女');
        if(roleCount.hunter)   parts.push(roleCount.hunter+'猎');
        if(roleCount.guard)    parts.push(roleCount.guard+'守');
        if(roleCount.villager) parts.push(roleCount.villager+'民');
        rolesEl.textContent = parts.join(' ');
    }
}

// ============================================================================
// 日志 & 发言 — 分级可见
// ============================================================================

// 根据游戏阶段自动推断发言可见性
function _inferVisibility(playerRole){
    const p = gameState.phase;
    if(p.startsWith('night-wolf')) return playerRole==='werewolf'?'wolves':'all';
    if(p.startsWith('night-seer')) return playerRole==='seer'?'self':'all';
    if(p.startsWith('night-witch')) return playerRole==='witch'?'self':'all';
    if(p.startsWith('night-guard')) return playerRole==='guard'?'self':'all';
    return 'all';
}

function _inferSystemVisibility(){
    const p = gameState.phase;
    if(p.startsWith('night-wolf')) return 'wolves';
    if(p.startsWith('night-seer')) return 'self';
    if(p.startsWith('night-witch')) return 'self';
    if(p.startsWith('night-guard')) return 'self';
    return 'all';
}

// 检查某个玩家是否可以看见某条发言
function _canSeeSpeech(player, speech){
    const vt = speech.visibleTo || 'all';
    if(vt==='all') return true;
    if(vt==='wolves') return player.role==='werewolf';
    if(vt==='self') return player.id===speech.playerId;
    if(Array.isArray(vt)) return vt.includes(player.id);
    return false;
}

function addLog(type, message, visibleTo){
    const vt = visibleTo || _inferSystemVisibility();
    gameState.log.push({ type, message, time: new Date(), visibleTo: vt });
    renderGameLog();
}

function addSpeech(playerId, playerName, role, content, visibleTo){
    const vt = visibleTo || _inferVisibility(role);
    const entry = { playerId, playerName, role, content, time: new Date(), visibleTo: vt };
    gameState.speeches.push(entry);
    renderSpeechArea();
    addLog('speech', `${playerName}（${ROLES[role]?ROLES[role].name:role}）：${content}`, vt);
}

function addSystemSpeech(content, visibleTo){
    const vt = visibleTo || _inferSystemVisibility();
    const entry = { playerId:'system', playerName:'系统', role:'system', content, time: new Date(), visibleTo: vt };
    gameState.speeches.push(entry);
    renderSpeechArea();
}

// ============================================================================
// 渲染：发言面板（主持人视角 — 所有发言可见 + 可见性标记）
// ============================================================================
function _visibilityLabel(vt){
    if(vt==='wolves') return '<span class="ww-vis-badge wolves">🐺狼人内部</span>';
    if(vt==='self')   return '<span class="ww-vis-badge self">🔒私密</span>';
    return '';
}
function renderSpeechArea(){
    const container = document.getElementById('speechArea');
    const countEl = document.getElementById('speechCount');
    if(!container) return;
    const speeches = gameState.speeches.slice(-100);
    if(speeches.length===0){
        container.innerHTML = '<div class="ww-speech-empty">等待游戏开始...</div>';
    } else {
        container.innerHTML = speeches.map(s=>{
            const visLabel = _visibilityLabel(s.visibleTo||'all');
            if(s.playerId==='system'){
                return `<div class="ww-speech-system">${visLabel}${esc(s.content)}</div>`;
            }
            const roleObj = ROLES[s.role];
            const tagClass = roleObj ? roleObj.team : 'village';
            const avatarBg = s.role==='werewolf' ? 'linear-gradient(135deg,#ef4444,#f87171)' :
                            s.role==='seer'     ? 'linear-gradient(135deg,#3b82f6,#60a5fa)' :
                            s.role==='witch'    ? 'linear-gradient(135deg,#a855f7,#c084fc)' :
                            s.role==='hunter'   ? 'linear-gradient(135deg,#f59e0b,#fbbf24)' :
                            s.role==='guard'    ? 'linear-gradient(135deg,#22c55e,#4ade80)' :
                                                  'linear-gradient(135deg,#6b7280,#9ca3af)';
            return `
            <div class="ww-speech-item" data-vis="${s.visibleTo||'all'}">
                <div class="ww-speech-header-row">
                    <div class="ww-speech-avatar" style="background:${avatarBg}">${esc(s.playerName[0]||'?')}</div>
                    <span class="ww-speech-name">${esc(s.playerName)}</span>
                    <span class="ww-speech-role-tag ${tagClass}">${roleObj?roleObj.emoji+' '+roleObj.name:esc(s.role)}</span>
                    ${visLabel}
                </div>
                <div class="ww-speech-content">${esc(s.content)}</div>
                <div class="ww-speech-time">${s.time.toLocaleTimeString()}</div>
            </div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    }
    if(countEl) countEl.textContent = speeches.length+' 条';
}

// ============================================================================
// 渲染：投票结果
// ============================================================================
function renderVoteResult(votes, tally, exiledId){
    // votes: { voterId: targetId }
    // tally: { targetId: count }
    const container = document.getElementById('speechArea');
    let html = `<div class="ww-vote-result"><div class="ww-vote-result-title">🗳️ 投票结果</div>`;

    // 明细表
    html += `<table class="ww-vote-detail-table">`;
    Object.entries(votes).forEach(([voterId, targetId])=>{
        const voter = gameState.players.find(p=>p.id===voterId);
        const target = gameState.players.find(p=>p.id===targetId);
        html += `<tr>
            <td class="voter">${esc(voter?voter.name:'?')}</td>
            <td class="arrow">→</td>
            <td class="target">${esc(target?target.name:'?')}</td>
        </tr>`;
    });
    html += `</table>`;

    // 柱状条
    const maxCount = Math.max(...Object.values(tally),1);
    html += `<div class="ww-vote-tally">`;
    Object.entries(tally).forEach(([targetId, count])=>{
        const target = gameState.players.find(p=>p.id===targetId);
        const targetRole = target ? ROLES[target.role] : null;
        const barClass = targetRole && targetRole.team==='wolf' ? 'wolf' : 'village';
        const pct = Math.round(count/maxCount*100);
        html += `<div class="ww-vote-tally-row">
            <span class="ww-vote-tally-name">${esc(target?target.name:'?')}</span>
            <div class="ww-vote-bar-wrap"><div class="ww-vote-bar ${barClass}" style="width:${pct}%"></div></div>
            <span class="ww-vote-tally-count">${count} 票</span>
        </div>`;
    });
    html += `</div>`;

    // 放逐结果
    if(exiledId){
        const exiled = gameState.players.find(p=>p.id===exiledId);
        if(exiled){
            html += `<div class="ww-vote-exile">${esc(exiled.name)}（${ROLES[exiled.role]?ROLES[exiled.role].name:'?'}）被放逐出局</div>`;
        }
    }

    html += `</div>`;
    // 追加到发言区
    if(container){
        container.innerHTML += html;
        container.scrollTop = container.scrollHeight;
    }
}

// ============================================================================
// 渲染：游戏面板
// ============================================================================
function renderGamePanel(){
    renderRoundTable();
    renderSpeechArea();
    renderGameLog();
    updateGameTopbar();
    renderCenterActions();
}

function renderRoundTable(){
    const ring = document.getElementById('playerRing');
    const container = document.getElementById('roundTable');
    if(!ring||!container) return;
    const count = gameState.players.length;
    if(count===0){ ring.innerHTML=''; return; }
    const rect = container.getBoundingClientRect();
    const w = rect.width||600, h=rect.height||600;
    const cx=w/2, cy=h/2;
    const radius = Math.min(cx,cy)*0.62;
    ring.innerHTML = gameState.players.map((p,i)=>{
        const angle = (2*Math.PI*i/count) - Math.PI/2;
        const x = cx + radius*Math.cos(angle);
        const y = cy + radius*Math.sin(angle);
        const role = ROLES[p.role];
        const deadClass = p.alive?'alive':'dead';
        const avatarBg = p.alive
            ? (p.role==='werewolf'?'linear-gradient(135deg,#ef4444,#f87171)':'linear-gradient(135deg,var(--ww-accent),#8b5cf6)')
            : 'linear-gradient(135deg,#4b5563,#6b7280)';
        return `<div class="ww-table-player ${deadClass}" style="left:${x}px;top:${y}px">
            <div class="ww-table-avatar" style="background:${avatarBg}">${esc(p.name[0]||'?')}</div>
            <div class="ww-table-name">${esc(p.name)}</div>
            <div class="ww-table-role">${role?role.emoji:'❓'}</div>
        </div>`;
    }).join('');
}

// ============================================================================
// 自动推进调度
// ============================================================================
function scheduleAutoAdvance(){
    if(!gameSettings.autoMode || gameState.gameOver) return;
    const phase = gameState.phase;
    let delayMs = 2500;
    if(phase.startsWith('day-speak')) delayMs = 3000;
    else if(phase === 'night-resolve') delayMs = 3000;
    else if(phase === 'day-vote') delayMs = 3000;

    setTimeout(() => {
        if(!gameSettings.autoMode || gameState.gameOver) return;
        if(phase.startsWith('night') && phase !== 'night-resolve'){
            proceedNightStep();
        } else if(phase === 'night-resolve'){
            proceedToDay();
        } else if(phase.startsWith('day')){
            proceedDayStep();
        }
    }, delayMs);
}

function renderCenterActions(){
    const container = document.getElementById('centerActions');
    if(!container) return;

    // 自动模式：显示状态并自动推进
    if(gameSettings.autoMode && !gameState.gameOver){
        container.innerHTML = `<div class="ww-auto-status">🤖 自动进行中<span class="ww-auto-dots"></span></div>`;
        scheduleAutoAdvance();
        return;
    }

    let html = '';
    const phase = gameState.phase;
    if(phase==='night-wolf-speak'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedNightStep()">🐺 狼人依次发言</button>`;
    } else if(phase==='night-wolf-vote'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedNightStep()">🗳️ 狼人投票袭击</button>`;
    } else if(phase==='night-seer-speak'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedNightStep()">🔮 预言家发言并查验</button>`;
    } else if(phase==='night-witch-speak'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedNightStep()">🧪 女巫发言并使用药水</button>`;
    } else if(phase==='night-guard-speak'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedNightStep()">🛡️ 守卫发言并守护</button>`;
    } else if(phase==='night-resolve'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedToDay()">☀️ 进入白天</button>`;
    } else if(phase==='day-announce'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedDayStep()">🗣️ 开始白天发言</button>`;
    } else if(phase==='day-speak'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedDayStep()">下一位发言</button>`;
    } else if(phase==='day-vote'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedDayStep()">🗳️ 开始投票</button>`;
    } else if(phase==='day-result'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedDayStep()">继续</button>`;
    } else if(phase==='day-lastwords'){
        html=`<button class="ww-btn ww-btn-primary" onclick="proceedDayStep()">继续</button>`;
    } else if(phase==='game-over'){
        html=`<button class="ww-btn ww-btn-primary" onclick="resetGame()">重新开始</button>
              <button class="ww-btn ww-btn-secondary" onclick="location.reload()">返回设置</button>`;
    }
    // 跳过按钮
    if(!gameState.gameOver && phase!=='setup' && phase!=='game-over'){
        html+=`<button class="ww-btn ww-btn-secondary" onclick="skipCurrentPhase()" style="margin-top:4px;font-size:11px;padding:6px 12px;">⏭️ 跳过此步骤</button>`;
    }
    container.innerHTML = html;
}

// ============================================================================
// 阶段推进
// ============================================================================
function proceedNightStep(){
    // 根据当前阶段推进
    const phase = gameState.phase;
    if(phase==='night-wolf-speak'){
        runWolfSpeakPhase();
    } else if(phase==='night-wolf-vote'){
        runWolfVotePhase();
    } else if(phase==='night-seer-speak'){
        runSeerPhase();
    } else if(phase==='night-witch-speak'){
        runWitchPhase();
    } else if(phase==='night-guard-speak'){
        runGuardPhase();
    }
}

async function runWolfSpeakPhase(){
    gameState.phase = 'night-wolf-speak';
    addSystemSpeech('🌙 天黑了，请所有人闭眼。狼人请睁眼！');
    updateBadge('night',`第 ${gameState.day} 夜 · 狼人阶段`);
    setPhaseUI('🌙','黑夜 · 狼人阶段','狼人请睁眼，你们要袭击谁？');
    renderCenterActions();

    const wolves = gameState.players.filter(p=>p.role==='werewolf'&&p.alive);
    const targets = gameState.players.filter(p=>p.alive&&p.role!=='werewolf');

    for(const wolf of wolves){
        addSystemSpeech(`🐺 ${wolf.name} 正在发言...`);
        const speech = await getAISpeech(wolf, 'wolf_night', { targets, gameState });
        addSpeech(wolf.id, wolf.name, wolf.role, speech);
        await delay(600);
    }
    // 进入投票阶段
    gameState.phase = 'night-wolf-vote';
    addSystemSpeech('🐺 狼人请投票决定袭击目标：');
    setPhaseUI('🌙','黑夜 · 狼人投票','狼人投票中...');
    renderCenterActions();
}

async function runWolfVotePhase(){
    const wolves = gameState.players.filter(p=>p.role==='werewolf'&&p.alive);
    const targets = gameState.players.filter(p=>p.alive&&p.role!=='werewolf');
    gameState.wolfVotes = {};
    // 每个狼人投票
    for(const wolf of wolves){
        let targetId = await getAIVote(wolf, targets, 'wolf_vote', { gameState });
        if(!targetId && targets.length>0) targetId = targets[Math.floor(Math.random()*targets.length)].id;
        if(targetId) gameState.wolfVotes[wolf.id] = targetId;
    }
    // 计票
    const tally = {};
    Object.values(gameState.wolfVotes).forEach(tid=>{ tally[tid]=(tally[tid]||0)+1; });
    const maxV = Math.max(...Object.values(tally),0);
    const candidates = Object.entries(tally).filter(([_,v])=>v===maxV);
    gameState.wolfTarget = candidates.length>0 ? candidates[0][0] : (targets.length>0?targets[0].id:null);

    const targetP = gameState.players.find(p=>p.id===gameState.wolfTarget);
    addSystemSpeech(`🐺 狼人投票结果：袭击目标是 ${targetP?targetP.name:'未知'}！`);
    addLog('night',`🐺 狼人决定击杀：${targetP?targetP.name:'未知'}`);

    // 下一阶段：预言家
    const hasSeer = gameState.players.some(p=>p.role==='seer'&&p.alive);
    if(hasSeer){
        gameState.phase = 'night-seer-speak';
        addSystemSpeech('🔮 预言家请睁眼...');
        setPhaseUI('🌙','黑夜 · 预言家阶段','预言家请睁眼，选择要查验的玩家');
    } else {
        // 跳到女巫
        const hasWitch = gameState.players.some(p=>p.role==='witch'&&p.alive);
        if(hasWitch){ gameState.phase='night-witch-speak'; addSystemSpeech('🧪 女巫请睁眼...'); }
        else { gameState.phase='night-guard-speak'; proceedNightStep(); return; }
    }
    renderCenterActions();
}

async function runSeerPhase(){
    gameState.phase = 'night-seer-speak';
    const seers = gameState.players.filter(p=>p.role==='seer'&&p.alive);
    if(seers.length===0){ proceedToNextNightRole(); return; }
    const seer = seers[0];
    const targets = gameState.players.filter(p=>p.alive&&p.id!==seer.id);

    // 发言
    addSystemSpeech(`🔮 ${seer.name} 正在思考...`);
    const speech = await getAISpeech(seer, 'seer_night', { targets, gameState });
    addSpeech(seer.id, seer.name, seer.role, speech);

    // 查验
    let targetId = await getAIDecision(seer, 'seer_check', targets);
    if(!targetId && targets.length>0) targetId = targets[Math.floor(Math.random()*targets.length)].id;
    gameState.seerTarget = targetId;
    const targetP = gameState.players.find(p=>p.id===targetId);
    if(targetP){
        const isWolf = targetP.role==='werewolf';
        gameState.seerResult = { targetId, isWolf };
        addSystemSpeech(`🔮 预言家查验了 ${targetP.name}，结果是：${isWolf?'【狼人】':'【好人】'}！`);
        addLog('night',`🔮 预言家查验了 ${targetP.name}，身份为：${isWolf?'狼人':'好人'}`);
    }

    // 下一角色
    const hasWitch = gameState.players.some(p=>p.role==='witch'&&p.alive);
    if(hasWitch){
        gameState.phase = 'night-witch-speak';
        addSystemSpeech('🧪 女巫请睁眼...');
        setPhaseUI('🌙','黑夜 · 女巫阶段','女巫请睁眼，选择是否使用药水');
    } else {
        proceedToNextNightRole();
    }
    renderCenterActions();
}

async function runWitchPhase(){
    gameState.phase = 'night-witch-speak';
    const witches = gameState.players.filter(p=>p.role==='witch'&&p.alive);
    if(witches.length===0){ proceedToNextNightRole(); return; }
    const witch = witches[0];

    // 发言
    addSystemSpeech(`🧪 ${witch.name} 正在思考...`);
    const speech = await getAISpeech(witch, 'witch_night', { wolfTarget:gameState.wolfTarget, gameState });
    addSpeech(witch.id, witch.name, witch.role, speech);

    // 解药
    if(!gameState.witchSaveUsed && gameState.wolfTarget){
        const targetP = gameState.players.find(p=>p.id===gameState.wolfTarget);
        addSystemSpeech(`🧪 今夜 ${targetP?targetP.name:'未知'} 被刀了，女巫是否使用解药？`);
        const saveDecision = await getAIDecision(witch, 'witch_save', [targetP]);
        if(saveDecision==='save'){
            gameState.witchSavedTarget = gameState.wolfTarget;
            gameState.witchSaveUsed = true;
            addSystemSpeech('🧪 女巫使用了解药！');
            addLog('night','🧪 女巫使用了解药');
        } else {
            addSystemSpeech('🧪 女巫没有使用解药。');
        }
    }

    // 毒药
    if(!gameState.witchPoisonUsed){
        const poisonTargets = gameState.players.filter(p=>p.alive);
        const poisonTargetId = await getAIDecision(witch, 'witch_poison', poisonTargets);
        if(poisonTargetId && poisonTargetId!=='none'){
            const pt = gameState.players.find(p=>p.id===poisonTargetId);
            if(pt){
                gameState.witchPoisonTarget = poisonTargetId;
                gameState.witchPoisonUsed = true;
                addSystemSpeech(`🧪 女巫使用毒药毒杀了 ${pt.name}！`);
                addLog('night',`🧪 女巫使用毒药，毒杀了 ${pt.name}`);
            }
        }
    }

    // 下一角色：守卫
    const hasGuard = gameState.players.some(p=>p.role==='guard'&&p.alive);
    if(hasGuard){
        gameState.phase = 'night-guard-speak';
        addSystemSpeech('🛡️ 守卫请睁眼...');
        setPhaseUI('🌙','黑夜 · 守卫阶段','守卫请睁眼，选择要守护的玩家');
    } else {
        proceedToNightResolve();
    }
    renderCenterActions();
}

async function runGuardPhase(){
    gameState.phase = 'night-guard-speak';
    const guards = gameState.players.filter(p=>p.role==='guard'&&p.alive);
    if(guards.length===0){ proceedToNightResolve(); return; }
    const guard = guards[0];
    const targets = gameState.players.filter(p=>p.alive&&p.id!==gameState.guardLastTarget);

    // 发言
    addSystemSpeech(`🛡️ ${guard.name} 正在思考...`);
    const speech = await getAISpeech(guard, 'guard_night', { targets, lastTarget:gameState.guardLastTarget, gameState });
    addSpeech(guard.id, guard.name, guard.role, speech);

    // 守护
    let targetId = await getAIDecision(guard, 'guard_protect', targets);
    if(!targetId && targets.length>0) targetId = targets[Math.floor(Math.random()*targets.length)].id;
    if(targetId){
        gameState.guardTarget = targetId;
        gameState.guardLastTarget = targetId;
        const tp = gameState.players.find(p=>p.id===targetId);
        addSystemSpeech(`🛡️ 守卫守护了 ${tp?tp.name:'未知'}！`);
        addLog('night',`🛡️ 守卫守护了 ${tp?tp.name:'未知'}`);
    }

    proceedToNightResolve();
}

function proceedToNightResolve(){
    gameState.phase = 'night-resolve';
    resolveNightDeaths();
}

function proceedToNextNightRole(){
    // 简化：直接跳到夜晚结算
    proceedToNightResolve();
}

function resolveNightDeaths(){
    const deaths = new Set();
    // 狼刀
    if(gameState.wolfTarget && gameState.witchSavedTarget!==gameState.wolfTarget){
        if(gameState.guardTarget!==gameState.wolfTarget){
            deaths.add(gameState.wolfTarget);
        } else {
            addSystemSpeech('🛡️ 守卫成功守护了被刀玩家！');
            addLog('night','🛡️ 守卫成功守护了被刀玩家');
        }
    } else if(gameState.wolfTarget && gameState.witchSavedTarget===gameState.wolfTarget){
        addSystemSpeech('🧪 女巫救活了被刀玩家！');
        addLog('night','🧪 女巫救活了被刀玩家');
    }
    // 毒药
    if(gameState.witchPoisonTarget) deaths.add(gameState.witchPoisonTarget);

    gameState.nightDeaths = [];
    deaths.forEach(pid=>{
        const p = gameState.players.find(p=>p.id===pid);
        if(p){ p.alive=false; gameState.nightDeaths.push(pid); }
    });

    if(gameState.nightDeaths.length>0){
        const names = gameState.nightDeaths.map(pid=>{
            const p = gameState.players.find(pp=>pp.id===pid); return p?p.name:'未知';
        }).join('、');
        addSystemSpeech(`💀 今夜死亡玩家：${names}`);
        addLog('death',`💀 今夜死亡：${names}`);
    } else {
        addSystemSpeech('🌙 今夜是平安夜！');
        addLog('night','昨晚是平安夜');
    }

    // 检查猎人
    gameState.nightDeaths.forEach(pid=>{
        const p = gameState.players.find(pp=>pp.id===pid);
        if(p&&p.role==='hunter'){
            addSystemSpeech(`🏹 ${p.name} 是猎人，出局时可以开枪！`);
        }
    });

    gameState.phase = 'night-resolve';
    setPhaseUI('🌙','黑夜 · 结算完成','夜晚阶段结束');
    renderCenterActions();
}

function proceedToDay(){
    gameState.phase = 'day-announce';
    updateBadge('day',`第 ${gameState.day} 天 · 白天`);
    // 公布夜晚结果
    if(gameState.nightDeaths.length>0){
        const names = gameState.nightDeaths.map(pid=>{
            const p=gameState.players.find(pp=>pp.id===pid); return p?p.name:'未知';
        }).join('、');
        addSystemSpeech(`☀️ 天亮了！昨夜 ${names} 死亡。`);
    } else {
        addSystemSpeech('☀️ 天亮了！昨夜是平安夜。');
    }
    setPhaseUI('☀️','白天 · 第 '+gameState.day+' 天','天亮了，请开始讨论');
    renderCenterActions();
}

// ========== 白天阶段 ==========
function proceedDayStep(){
    const phase = gameState.phase;
    if(phase==='day-announce'){
        // 开始发言
        gameState.phase = 'day-speak';
        gameState.currentSpeakerIdx = 0;
        addSystemSpeech('🗣️ 现在开始白天发言，从 1 号玩家开始：');
        setPhaseUI('☀️','白天 · 发言阶段','玩家依次发言中...');
        renderCenterActions();
        // 自动触发第一位发言
        runNextSpeech();
    } else if(phase==='day-speak'){
        runNextSpeech();
    } else if(phase==='day-vote'){
        runVotingPhase();
    } else if(phase==='day-result'){
        // 放逐后
        proceedAfterExile();
    } else if(phase==='day-lastwords'){
        proceedAfterLastWords();
    }
}

async function runNextSpeech(){
    const alive = gameState.players.filter(p=>p.alive);
    if(gameState.currentSpeakerIdx >= alive.length){
        // 所有玩家发言完毕，进入投票
        gameState.phase = 'day-vote';
        addSystemSpeech('🗣️ 所有玩家发言完毕，现在进入投票阶段！');
        setPhaseUI('🗳️','白天 · 投票阶段','投票放逐');
        renderCenterActions();
        return;
    }
    const speaker = alive[gameState.currentSpeakerIdx];
    addSystemSpeech(`🗣️ ${speaker.name} 正在发言...`);
    const speech = await getAISpeech(speaker, 'day_speak', { alive, day:gameState.day, gameState });
    addSpeech(speaker.id, speaker.name, speaker.role, speech);
    gameState.currentSpeakerIdx++;
    renderCenterActions();
}

async function runVotingPhase(){
    gameState.phase = 'day-vote';
    addSystemSpeech('🗳️ 投票中...');
    setPhaseUI('🗳️','白天 · 投票中','投票进行中...');

    // 显示投票中状态
    const container = document.getElementById('speechArea');
    if(container){
        container.innerHTML += `<div class="ww-vote-progress" id="voteProgress">
            <div class="ww-vote-progress-spinner"></div>
            <div class="ww-vote-progress-text">AI 玩家中，正在投票...</div>
        </div>`;
        container.scrollTop = container.scrollHeight;
    }

    const alive = gameState.players.filter(p=>p.alive);
    gameState.votes = {};
    for(const voter of alive){
        const targets = alive.filter(p=>p.id!==voter.id);
        if(targets.length===0) continue;
        let targetId = await getAIVote(voter, targets, 'day_vote', { gameState, day:gameState.day });
        if(!targetId) targetId = targets[Math.floor(Math.random()*targets.length)].id;
        gameState.votes[voter.id] = targetId;
    }

    // 计票
    const tally = {};
    Object.values(gameState.votes).forEach(tid=>{ tally[tid]=(tally[tid]||0)+1; });
    gameState.voteTally = tally;
    gameState.exiledVoteTally = { votes:{...gameState.votes}, tally:{...tally} };

    // 找出最高票
    const maxV = Math.max(...Object.values(tally),0);
    const candidates = Object.entries(tally).filter(([_,v])=>v===maxV);

    if(candidates.length>1 || maxV===0){
        addSystemSpeech('🗳️ 投票结果：平票或无人得票，无人被放逐！');
        gameState.exiledPlayerId = null;
    } else {
        gameState.exiledPlayerId = candidates[0][0];
        const exiled = gameState.players.find(p=>p.id===gameState.exiledPlayerId);
        if(exiled){
            exiled.alive = false;
            addSystemSpeech(`🗳️ 投票结果：${exiled.name} 被放逐出局！身份是 ${ROLES[exiled.role]?ROLES[exiled.role].name:exiled.role}。`);
            addLog('vote',`🗳️ ${exiled.name} 被投票放逐`);
        }
    }

    // 渲染投票结果到发言区
    renderVoteResult(gameState.votes, tally, gameState.exiledPlayerId);

    // 进入放逐后阶段
    gameState.phase = 'day-result';
    setPhaseUI('🗳️','白天 · 投票结果','投票结束');
    renderCenterActions();
}

function proceedAfterExile(){
    // 检查猎人
    if(gameState.exiledPlayerId){
        const exiled = gameState.players.find(p=>p.id===gameState.exiledPlayerId);
        if(exiled && exiled.role==='hunter'){
            gameState.phase = 'day-lastwords';
            addSystemSpeech(`🏹 ${exiled.name} 是猎人，出局时可以开枪带走一人！`);
            setPhaseUI('🏹','白天 · 猎人开枪','猎人选择开枪目标');
            renderCenterActions();
            return;
        }
    }
    proceedToNextDayOrEnd();
}

function proceedAfterLastWords(){
    // 猎人开枪
    if(gameState.exiledPlayerId){
        const exiled = gameState.players.find(p=>p.id===gameState.exiledPlayerId);
        if(exiled && exiled.role==='hunter'){
            const alive = gameState.players.filter(p=>p.alive);
            if(alive.length>0){
                // AI 决定开枪目标
                getAIDecision(exiled,'hunter_shoot',alive).then(targetId=>{
                    if(!targetId && alive.length>0) targetId = alive[Math.floor(Math.random()*alive.length)].id;
                    if(targetId){
                        const target = gameState.players.find(p=>p.id===targetId);
                        if(target){ target.alive=false; addSystemSpeech(`🏹 猎人 ${exiled.name} 开枪带走了 ${target.name}！`); }
                    }
                    proceedToNextDayOrEnd();
                });
                return;
            }
        }
    }
    proceedToNextDayOrEnd();
}

function proceedToNextDayOrEnd(){
    // 检查游戏是否结束
    const aliveWolves = gameState.players.filter(p=>p.alive&&p.role==='werewolf').length;
    const aliveVillage = gameState.players.filter(p=>p.alive&&p.role!=='werewolf').length;
    if(aliveWolves===0){ endGame('village'); return; }
    if(aliveVillage<=aliveWolves){ endGame('wolf'); return; }
    // 进入下一天
    gameState.day++;
    gameState.nightDeaths = [];
    gameState.wolfTarget = null;
    gameState.seerTarget = null;
    gameState.seerResult = null;
    gameState.witchSavedTarget = null;
    gameState.witchPoisonTarget = null;
    gameState.guardTarget = null;
    enterNightPhase();
}

function enterNightPhase(){
    // 检查游戏是否结束
    const aliveWolves = gameState.players.filter(p=>p.alive&&p.role==='werewolf').length;
    const aliveVillage = gameState.players.filter(p=>p.alive&&p.role!=='werewolf').length;
    if(aliveWolves===0){ endGame('village'); return; }
    if(aliveVillage<=aliveWolves){ endGame('wolf'); return; }

    gameState.phase = 'night-wolf-speak';
    addLog('night',`🌙 第 ${gameState.day} 夜降临`);
    updateBadge('night',`第 ${gameState.day} 夜`);
    updateGameTopbar();
    proceedNightStep();
}

// ============================================================================
// 游戏结束
// ============================================================================
function endGame(winner){
    gameState.gameOver = true;
    gameState.winner = winner;
    gameState.phase = 'game-over';
    if(winner==='village'){
        addSystemSpeech('🎉 好人阵营获胜！所有狼人已被消灭！');
        updateBadge('game-over','好人获胜 🎉');
    } else {
        addSystemSpeech('🐺 狼人阵营获胜！狼人占领了村庄！');
        updateBadge('game-over','狼人获胜 🐺');
    }
    // 揭示身份
    addSystemSpeech('── 最终身份 ──');
    gameState.players.forEach(p=>{
        const role = ROLES[p.role];
        addSystemSpeech(`${p.alive?'✅':'💀'} ${p.name}：${role?role.emoji+' '+role.name:p.role}`);
    });
    setPhaseUI(winner==='village'?'🎉':'🐺', '游戏结束', winner==='village'?'好人阵营获胜！':'狼人阵营获胜！');
    renderCenterActions();
}

// ============================================================================
// AI 接口 — 策略重写版
// 每个AI玩家基于完整游戏上下文进行深度策略思考后发言/投票
// ============================================================================

// 本地发言去重器：同类型下避免重复
const _speechUsed = {};

// 构建完整游戏上下文摘要（所有身份通用）
// ⚠️ 严格按狼人杀规则：只暴露该角色有权知道的信息
function _playerNum(playerId){
    const p = gameState.players.find(pp=>pp.id===playerId);
    return p ? p.displayNum : '?';
}
function buildGameContext(player){
    const all = gameState.players;
    const alive = all.filter(p=>p.alive);
    const dead = all.filter(p=>!p.alive);
    const day = gameState.day;
    const lines = [];

    lines.push(`【第${day}天】`);
    lines.push(`你的编号：${player.displayNum}号  你的身份：${ROLES[player.role].emoji} ${ROLES[player.role].name}`);

    // 存活玩家（只显示编号）
    const aliveNums = alive.map(p=>{
        const marker = p.id===player.id?' ★你':'';
        return `${p.displayNum}号${marker}`;
    }).join('、');
    lines.push(`存活玩家(${alive.length}人)：${aliveNums}`);

    // 已死亡玩家（只显示编号）
    if(dead.length>0){
        const deadNums = dead.map(p=>`${p.displayNum}号`).join('、');
        lines.push(`已死亡玩家：${deadNums}`);
    }

    // 昨夜死亡（只显示编号）
    if(gameState.nightDeaths && gameState.nightDeaths.length>0){
        const ndNums = gameState.nightDeaths.map(pid=>`${_playerNum(pid)}号`).join('、');
        lines.push(`昨夜死亡：${ndNums}`);
    } else if(day>1){
        lines.push('昨夜是平安夜（无人死亡）');
    }

    // 今日放逐（公开信息，显示编号+身份已公开）
    const exiledToday = dead.filter(p=>p.id===gameState.exiledPlayerId);
    if(exiledToday.length>0){
        const ex = exiledToday[0];
        lines.push(`今日被放逐：${ex.displayNum}号（身份已公开：${ROLES[ex.role].emoji}${ROLES[ex.role].name}）`);
    }

    // ========== 角色专属信息 ==========
    if(player.role==='werewolf'){
        const wolves = alive.filter(p=>p.role==='werewolf');
        const companions = wolves.filter(p=>p.id!==player.id);
        if(companions.length>0){
            const compStr = companions.map(p=>`${p.displayNum}号(${p.name})`).join('、');
            lines.push(`【狼人专属】你的狼同伴：${compStr}（共${wolves.length}名狼人存活）`);
        } else {
            lines.push('【狼人专属】你目前是唯一的存活的狼人。');
        }
    }

    if(player.role==='seer'){
        const checks = [];
        // 从游戏日志/状态中提取查验历史
        if(gameState.seerTarget && gameState.seerResult){
            const tp = all.find(p=>p.id===gameState.seerTarget);
            if(tp){
                checks.push(`${tp.displayNum}号 → ${gameState.seerResult.isWolf?'【狼人】':'【好人】'}`);
            }
        }
        if(checks.length>0){
            lines.push(`【预言家专属】你的查验记录：${checks.join('；')}`);
        } else {
            lines.push('【预言家专属】你尚未查验任何玩家。');
        }
    }

    if(player.role==='witch'){
        const saveStatus = gameState.witchSaveUsed ? '已用' : '未用';
        const poisonStatus = gameState.witchPoisonUsed ? '已用' : '未用';
        lines.push(`【女巫专属】解药：${saveStatus}　毒药：${poisonStatus}`);
        if(gameState.wolfTarget && !gameState.witchSaveUsed){
            const wtp = all.find(p=>p.id===gameState.wolfTarget);
            if(wtp) lines.push(`【女巫专属】今夜被刀的是 ${wtp.displayNum}号，你可以选择使用解药救人。`);
        }
    }

    if(player.role==='guard'){
        const guarded = [];
        if(gameState.guardLastTarget){
            const gp = all.find(p=>p.id===gameState.guardLastTarget);
            if(gp) guarded.push(`${gp.displayNum}号`);
        }
        if(guarded.length>0){
            lines.push(`【守卫专属】你上一次守护了：${guarded.join('、')}`);
        }
    }

    // ========== 公开信息 ==========
    // 近期发言（仅可见范围内的非系统发言，最后15条，显示为中性编号）
    const recent = gameState.speeches
        .filter(s=>s.playerId!=='system' && _canSeeSpeech(player, s))
        .slice(-15);
    if(recent.length>0){
        lines.push('近期发言：');
        recent.forEach(s=>{
            const num = _playerNum(s.playerId);
            lines.push(`  ${num}号：${s.content}`);
        });
    }

    // 本玩家之前的所有发言
    const myHistory = gameState.speeches.filter(s=>s.playerId===player.id);
    if(myHistory.length>0){
        lines.push('你之前的发言：');
        myHistory.forEach(s=>{ lines.push(`  ${s.content}`); });
    }

    return lines.join('\n');
}

// ========== 获取 AI 发言 ==========
async function getAISpeech(player, contextType, contextData){
    const cfg = roleConfigs[player.role];
    if(!cfg || !cfg.enabled){
        return getLocalSpeech(player, contextType, contextData);
    }
    try {
        const sys = buildSystemPrompt(player, contextType);
        const user = buildSpeechPrompt(player, contextType, contextData);
        const text = await callAIAPI(cfg.providerId, cfg.model, sys, user);
        if(text && text.trim().length>0) return text.trim();
    } catch(e){
        addLog('error',`⚠️ ${player.name} API发言失败: ${e.message}，使用本地发言`);
    }
    return getLocalSpeech(player, contextType, contextData);
}

// ========== 获取 AI 投票 ==========
async function getAIVote(player, targets, voteType, contextData){
    const cfg = roleConfigs[player.role];
    if(!cfg || !cfg.enabled){
        return getLocalVote(player, targets, voteType, contextData);
    }
    try {
        const sys = buildVoteSystemPrompt(player, voteType);
        const user = buildVotePrompt(player, targets, voteType, contextData);
        const text = await callAIAPI(cfg.providerId, cfg.model, sys, user);
        if(text){
            const m = text.match(/player_\d+_\d+/);
            if(m) return m[0];
        }
    } catch(e){
        addLog('error',`⚠️ ${player.name} API投票失败: ${e.message}`);
    }
    return getLocalVote(player, targets, voteType, contextData);
}

// ========== 获取 AI 决策（查验/用药/守护/开枪）==========
async function getAIDecision(player, actionType, targets){
    const cfg = roleConfigs[player.role];
    if(!cfg || !cfg.enabled) return getLocalDecision(player, actionType, targets);
    try {
        const sys = buildDecisionSystemPrompt(player, actionType);
        const user = buildDecisionPrompt(player, actionType, targets);
        const text = await callAIAPI(cfg.providerId, cfg.model, sys, user);
        if(text){
            const t = text.trim().toLowerCase();
            if(actionType==='witch_save') return t.includes('save')?'save':'none';
            if(actionType==='witch_poison'){
                if(t.includes('none')) return 'none';
                const m=text.match(/player_\d+_\d+/); return m?m[0]:'none';
            }
            const m=text.match(/player_\d+_\d+/); return m?m[0]:null;
        }
    } catch(e){
        addLog('error',`⚠️ ${player.name} API决策失败: ${e.message}`);
    }
    return getLocalDecision(player, actionType, targets);
}

// ========== 统一 API 调用（经后端代理，使用角色对应的 provider）==========
async function callAIAPI(providerId, model, systemMessage, userMessage){
    const resp = await fetch('/api/werewolf/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            provider_id: providerId,
            model: model,
            system_prompt: systemMessage,
            user_message: userMessage,
            temperature: 0.85
        })
    });
    if(!resp.ok){
        const err = await resp.text().catch(()=>'');
        throw new Error(`HTTP ${resp.status}: ${err.slice(0,200)}`);
    }
    const data = await resp.json();
    return data.content || '';
}

// ========================================================================
// System Prompt — 真人化发言（口语化、自然）
// ========================================================================
function buildSystemPrompt(player, contextType){
    const r = ROLES[player.role];
    const base = `你是狼人杀中的真实玩家。你叫${player.name}，身份是${r.emoji} ${r.name}。

【核心要求】
- 发言必须像真人一样自然随意，像微信聊天、像朋友说话，不要模板化
- 可以用口语词：嘛、吧、啊、呢、呀、呗、哈、啧、呃、emmm
- 可以打错别字、用省略号、用短句、反问句
- 禁止说"根据我的分析""综上所述""我认为有以下几点""大家注意听我说""我觉得XX发言不太好"
- 禁止说"目前局势比较明朗""大家要团结一致"这类机器人套话
- 可以撒谎、伪装身份、装晕、带节奏、跟风、沉默式发言——完全自由
- 不要长篇大论，像正常人发言就行

【禁止的模板化表达（绝对不要用）】
❌ "我仔细听了前面的发言，有几点让我比较在意"
❌ "从今天的发言来看，我目前有几个怀疑对象"
❌ "我觉得大家要冷静分析，不要急着投票"
❌ "目前存活的玩家还有X位，我们要慎重"
❌ "我注意到有些玩家的发言内容和立场一直在变化"
❌ "从逻辑上来看"、"按照目前的局势"
❌ "这一轮投票非常重要"

【角色的自然发言方向】`;

    const strategies = {
        werewolf: `${base}
你是狼人，你的阵营是狼人。你要装好人活到最后。
- 白天你就当自己是村民，该怎么聊怎么聊
- 可以踩人（说谁可疑），但别踩你狼同伴
- 被踩了就喊冤，演得像一点
- 可以跟风别人，也可以带节奏
- 别表现得什么都知道——村民不知道夜里死了谁
- 晚上和狼同伴商量时直接说刀谁，不用伪装
- 你也可以跳预言家报假查验、跳女巫报假银水，随便演`,

        seer: `${base}
你是预言家。每晚查一个人是狼人还是好人。
- 查到狼可以白天跳身份报结果，但跳了你会成为狼人首要目标
- 查到几个好人了还没查到狼，可以先藏着继续观察
- 发言要自然地引导方向，别太像教学
- 有人跟你对跳预言家，怼回去——假预言家是你最大的敌人`,

        witch: `${base}
你是女巫。有一瓶解药（救人）和一瓶毒药（杀人），各用一次。
- 你知道昨晚谁被刀了，但白天不能说"我是女巫我知道"
- 可以用模糊的方式引导话题
- 第一晚大概率用解药，因为被刀的可能是预言家
- 毒药很珍贵，留给确定是狼的人
- 你自己权衡：隐藏身份还是分享信息`,

        hunter: `${base}
你是猎人。你出局时可以开枪带走一个人。
- 发言可以硬气一点，敢怼人
- 被票出去可以开枪，所以不怕被票
- 但晚上被刀开不了枪，所以别太招摇
- 你活着就是对狼人的威慑`,

        guard: `${base}
你是守卫。每晚守一个人，不能连续两晚守同一个。
- 发言正常分析就行，别暴露你守了谁
- 如果出了平安夜，可能是你的功劳——但不能说
- 观察谁可能是狼人的下一个目标`,

        villager: `${base}
你是村民。除了投票什么能力都没有。
- 认真听每个人说话，找漏洞
- 大胆说出你的怀疑——你是好人的信息源
- 别人跳预言家，别轻易信，狼人也可能跳
- 投票是你唯一的武器，每一票都想清楚`};

    const s = strategies[player.role] || strategies.villager;
    const nightTip = contextType && contextType.includes('night') ?
        '\n【现在是夜晚】只输出你要说的话或你想讨论的内容，别管白天那套。' : '';
    const dayTip = contextType === 'day_speak' ?
        '\n【现在是白天发言环节】轮到你了。发言长度30-60字最合适，关键轮次可以多说点但别超100字。自然点，别像背稿子。' : '';
    return s + nightTip + dayTip + '\n\n直接输出发言内容，不要加前缀自我介绍。';
}

// ========================================================================
// User Prompt — 包含完整游戏状态
// ========================================================================
function buildSpeechPrompt(player, contextType, contextData){
    const ctx = buildGameContext(player);
    let phase = '';
    if(contextType==='wolf_night'){
        phase = `【当前阶段】夜晚 · 狼人讨论。和同伴商量今晚刀谁。`;
    } else if(contextType==='seer_night'){
        phase = `【当前阶段】夜晚 · 预言家行动。你正在思考查验谁。`;
    } else if(contextType==='witch_night'){
        const wt = gameState.wolfTarget;
        const wtp = wt ? gameState.players.find(p=>p.id===wt) : null;
        phase = `【当前阶段】夜晚 · 女巫行动。${wtp?'今夜'+wtp.displayNum+'号被刀了。':''}决定是否使用解药/毒药。`;
    } else if(contextType==='guard_night'){
        phase = `【当前阶段】夜晚 · 守卫行动。选择你要守护的人。`;
    } else if(contextType==='day_speak'){
        phase = `【当前阶段】白天第${gameState.day}天 · 发言环节。轮到你了，请发言。`;
    }
    return ctx + '\n\n' + phase + '\n\n请发言：';
}

// ========== 投票 Prompt ==========
function buildVoteSystemPrompt(player, voteType){
    const r = ROLES[player.role];
    if(voteType==='wolf_vote'){
        return `你是${r.name}，和狼同伴一起投票决定今夜袭击目标。选对狼人阵营最有利的目标。只回复目标ID（格式 player_XXX_XX）。`;
    }
    return `你是${r.name}，正在投票放逐玩家。综合分析局势，选你认为最应该被放逐的人。只回复目标ID。`;
}

function buildVotePrompt(player, targets, voteType, contextData){
    const ctx = buildGameContext(player);
    const tgtStr = targets.map(t=>`  ${t.displayNum}号  [${t.id}]`).join('\n');
    return ctx + `\n\n【可投票对象】\n${tgtStr}\n\n请投票，只回复目标ID([...]中的内容)。`;
}

function buildDecisionSystemPrompt(player, actionType){
    const r = ROLES[player.role];
    const map = {
        seer_check:    `你是${r.name}，选择查验目标。只回复目标ID。`,
        witch_save:    `你是女巫，是否用解药救人？只回复 save 或 none。`,
        witch_poison:  `你是女巫，是否用毒药杀人？回复目标ID或none。`,
        guard_protect: `你是守卫，选择守护目标（不能连续两晚守同一人）。只回复目标ID。`,
        hunter_shoot:  `你是猎人，出局时可开枪带走一人。只回复目标ID。`
    };
    return map[actionType] || `做出决策。只回复目标ID。`;
}

function buildDecisionPrompt(player, actionType, targets){
    const ctx = buildGameContext(player);
    const tgtStr = targets ? targets.map(t=>`${t.displayNum}号(${t.id})`).join(', ') : '';
    return ctx + `\n\n【可选目标】${tgtStr}\n\n请决策：`;
}

// ========================================================================
// 增强本地 Fallback — 策略性 + 去重
// ========================================================================
function _pickUniqueSpeech(ctxType, playerId){
    if(!_speechUsed[ctxType]) _speechUsed[ctxType] = [];
    const used = _speechUsed[ctxType];
    return (pool) => {
        const available = pool.filter(s=>!used.includes(s));
        if(available.length===0){ used.length=0; return pool[Math.floor(Math.random()*pool.length)]; }
        const pick = available[Math.floor(Math.random()*available.length)];
        used.push(pick);
        if(used.length>pool.length*0.8) used.shift();
        return pick;
    };
}

function getLocalSpeech(player, contextType, contextData){
    const pick = _pickUniqueSpeech(contextType, player.id);
    const alive = gameState.players.filter(p=>p.alive);
    const aliveNames = alive.map(p=>p.name).join('、');
    const day = gameState.day;

    const lib = {
        wolf_night: [
            `刀那个话最多的吧，像有身份的`,
            `我觉得刀个低调的，不容易被救`,
            `先刀预言家，不然他查到我们咋办`,
            `别刀发言多的 容易暴露我们`,
            `今晚保守点？刀个村民算了`,
            `谁像预言家先刀谁，别拖`,
            `女巫解药可能还在 刀了白刀`,
            `大家说刀谁？我倾向刀沉默那个`,
            `我观察了下 发言积极的像神职`,
            `避开守卫可能守的人 刀个冷门的`,
            `今晚必须统一，别分票。我建议刀那个像预言家的`,
            `都说说想法吧 然后统一一个目标`,
            `啧 感觉不好选 大家觉得呢`,
        ],
        seer_night: [
            `今晚查谁呢……那个发言奇怪的`,
            `查一下那个话多的 感觉有东西`,
            `希望查到狼 明天直接跳`,
            `查谁最能帮好人 想想`,
            `如果查到好人 我得继续藏着`,
            `今晚查验很关键 得好好选`,
            `查那个发言前后矛盾的`,
            `emmm 感觉谁都可能 再想想`,
        ],
        witch_night: [
            `解药用不用呢 纠结`,
            `万一被刀的是预言家 必须救吧`,
            `我看下情况再决定`,
            `毒药不急 留给确定的狼`,
            `毒药轻易不能用 先看看`,
            `啧 今晚这情况 不好说`,
            `解药先留着？还是用了吧`,
        ],
        guard_night: [
            `今晚守谁呢 我猜狼会刀预言家`,
            `守预言家最稳`,
            `不能连续守同一个 得换`,
            `谁最可能被刀就守谁`,
            `守对了就是平安夜 想想`,
            `狼人心理……他们会刀谁呢`,
        ],
        day_speak: [
            `3号你刚才那话啥意思啊 我听不太对`,
            `我是预言家 昨晚查了5号 铁狼 今天全票出5`,
            `emmmm没啥信息 过吧`,
            `6号你跳预言家？那你倒是说说查了谁`,
            `我感觉4号有点问题 但又说不上来`,
            `我跟风吧 目前没啥想法`,
            `5号被刀了 那昨晚肯定有信息 预言家查了吗`,
            `我觉得别急着投票 再多听几个人的`,
            `8号发言一直在绕 听着像在编`,
            `${day>1?'昨儿'+gameState.nightDeaths.length+'个人没了 ':''}我倾向出3号 感觉不对`,
            `票4吧 他发言最奇怪`,
            `我信2号是真预言家 7号跳的太假了`,
            `你们不觉得1号和6号互踩得很刻意吗 可能是狼踩狼`,
            `场上还剩${alive.length}个人 狼坑应该就在那几个里面`,
            `我跟5号票 5号归谁我归谁`,
            `别分票啊大家 统一出4`,
            `2号查验报的没啥问题 我站边2号`,
            `什么鬼 怎么都冲我来了 我就是个民`,
            `行吧 我跳身份 我是猎人 别票我`,
            `啧 我也说不清楚 但就是觉得不对劲`,
        ],
    };
    const pool = lib[contextType] || lib.day_speak;
    return pick(pool);
}

// 本地策略投票 — 非纯随机
function getLocalVote(player, targets, voteType, contextData){
    if(targets.length===0) return null;
    if(targets.length===1) return targets[0].id;

    if(voteType==='wolf_vote'){
        // 狼人优先刀神职(预言家>女巫>守卫>猎人>村民)
        const priority = ['seer','witch','guard','hunter','villager'];
        for(const role of priority){
            const candidates = targets.filter(t=>t.role===role);
            if(candidates.length>0) return candidates[Math.floor(Math.random()*candidates.length)].id;
        }
    } else {
        // 白天投票：狼人集中票一个好人，好人随机但有偏好的投
        if(player.role==='werewolf'){
            // 狼人协同：优先票预言家或发言积极的非狼人
            const nonWolves = targets.filter(t=>t.role!=='werewolf');
            if(nonWolves.length>0){
                const seers = nonWolves.filter(t=>t.role==='seer');
                if(seers.length>0) return seers[0].id;
                return nonWolves[Math.floor(Math.random()*nonWolves.length)].id;
            }
        } else {
            // 好人：稍微避开投票自己同阵营（虽然不知道，但可以模拟）
            // 纯随机但有微量倾向避开自己
            const others = targets.filter(t=>true);
            return others[Math.floor(Math.random()*others.length)].id;
        }
    }
    return targets[Math.floor(Math.random()*targets.length)].id;
}

// 本地决策 — 带策略的非随机
function getLocalDecision(player, actionType, targets){
    if(!targets || targets.length===0) return null;
    if(actionType==='witch_save'){
        // 第一晚大概率救，之后看情况
        return gameState.day===1 ? 'save' : (Math.random()>0.5?'save':'none');
    }
    if(actionType==='witch_poison'){
        // 毒药保守：大概率不用
        return Math.random()>0.7 ? targets[Math.floor(Math.random()*targets.length)].id : 'none';
    }
    if(actionType==='hunter_shoot'){
        // 猎人开枪：优先打发言少的（可能隐藏的狼）
        const sorted = [...targets].sort(()=>Math.random()-0.5);
        return sorted[0].id;
    }
    // 预言家查验、守卫守护：随机
    const r = targets[Math.floor(Math.random()*targets.length)];
    return r ? r.id : null;
}

// ============================================================================
// UI 辅助
// ============================================================================
function setPhaseUI(icon, title, desc){
    const iconEl=document.getElementById('phaseIcon');
    const titleEl=document.getElementById('phaseTitle');
    const descEl=document.getElementById('phaseDesc');
    const dayEl=document.getElementById('dayCounter');
    if(iconEl) iconEl.textContent=icon;
    if(titleEl) titleEl.textContent=title;
    if(descEl) descEl.textContent=desc;
    if(dayEl) dayEl.textContent='第 '+gameState.day+' 天';
}

function updateBadge(type, text){
    const badge=document.getElementById('gamePhaseBadge');
    if(!badge) return;
    const span=badge.querySelector('.ww-phase-badge');
    if(span){ span.className='ww-phase-badge '+type; span.textContent=text; }
}

function renderGameLog(){
    const container=document.getElementById('gameLog');
    if(!container) return;
    container.innerHTML=gameState.log.slice(-50).map(e=>{
        const vt = e.visibleTo||'all';
        const badge = vt==='wolves'?'<span class="ww-log-badge wolves">🐺</span>'
                    : vt==='self'?'<span class="ww-log-badge self">🔒</span>':'';
        return `<div class="ww-log-entry ${e.type}" data-vis="${vt}">[${e.time.toLocaleTimeString()}] ${badge}${esc(e.message)}</div>`;
    }).join('');
    container.scrollTop=container.scrollHeight;
}

function clearError(){ 
    const el=document.getElementById('startGameError'); 
    if(el){ el.style.display='none'; el.textContent=''; } 
}
function showError(msg){ 
    const el=document.getElementById('startGameError'); 
    if(el){ el.textContent=msg; el.style.display='block'; 
        setTimeout(()=>{ el.style.display='none'; },4000); 
    }
}

function toggleLog(){
    const panel=document.querySelector('.ww-log-panel');
    if(panel) panel.classList.toggle('collapsed');
}

function resetGame(){
    gameState.phase='setup'; gameState.day=1; gameState.log=[]; 
    gameState.winner=null; gameState.gameOver=false;
    gameState.players.forEach(p=>{ p.alive=true; });
    document.getElementById('setupPanel').style.display='block';
    document.getElementById('gamePanel').style.display='none';
    updateBadge('setup','游戏设置');
    renderSetupPanel();
}

function skipCurrentPhase(){
    const phase=gameState.phase;
    if(phase.startsWith('night-wolf')){ proceedToNextNightRole(); }
    else if(phase.startsWith('night-seer')){ proceedToNextNightRole(); }
    else if(phase.startsWith('night-witch')){ proceedToNextNightRole(); }
    else if(phase.startsWith('night-guard')){ proceedToNightResolve(); }
    else if(phase==='day-announce'){ gameState.phase='day-speak'; gameState.currentSpeakerIdx=0; proceedDayStep(); }
    else if(phase==='day-speak'){ gameState.phase='day-vote'; proceedDayStep(); }
    else if(phase==='day-vote'){ proceedDayStep(); }
    else if(phase==='day-result'){ proceedAfterExile(); }
    else if(phase==='day-lastwords'){ proceedAfterLastWords(); }
}

function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }

function esc(s){ 
    if(!s) return ''; 
    return s.toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); 
}

// ========== 暴露全局函数 ==========
window.applyPreset=applyPreset;
window.startGame=startGame;
window.toggleLog=toggleLog;
window.resetGame=resetGame;
window.toggleAutoMode=toggleAutoMode;
