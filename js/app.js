/* ==========================================
   MONEYMENTOR — LÓGICA DE LA APLICACIÓN
========================================== */

// Claves del prototipo anterior (solo se usan para limpiar el navegador)
const USERS_KEY = "moneymentor_users_v1";
const SESSION_KEY = "moneymentor_session_v1";
const LEGACY_MOVEMENTS_KEY = "moneymentor_movements_v1";
const LEGACY_GOALS_KEY = "moneymentor_goals_v1";

// ======================================
// CONEXIÓN CON EL BACKEND DE MONEYMENTOR
// ======================================

// Dirección del backend publicado en Render (cámbiala por la tuya)
const PRODUCTION_API_URL = "https://TU-SERVICIO.onrender.com/api";

// En tu computadora usa el servidor local; en GitHub Pages o en el APK, el de Render
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) || location.protocol === "file:";
const API_URL = IS_LOCAL ? "http://localhost:3000/api" : PRODUCTION_API_URL;
const AUTH_TOKEN_KEY = "moneymentor_auth_token";

function getAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) ||
           sessionStorage.getItem(AUTH_TOKEN_KEY);
}

function saveAuthToken(token, remember = true) {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);

    if (remember) {
        localStorage.setItem(AUTH_TOKEN_KEY, token);
    } else {
        sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    }
}

function clearAuthToken() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
}

let serverWakeNoticeShown = false;

async function apiRequest(endpoint, options = {}) {
    const token = getAuthToken();

    const headers = {
        "Content-Type": "application/json",
        ...options.headers
    };

    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    // El plan gratuito de Render se duerme tras 15 min sin uso y tarda en despertar
    const wakeUpTimer = setTimeout(() => {
        if (!serverWakeNoticeShown) {
            serverWakeNoticeShown = true;
            toast("El servidor se está activando. La primera vez puede tardar hasta un minuto.", "info");
        }
    }, 5000);

    let response;
    try {
        response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers
        });
    } catch {
        clearTimeout(wakeUpTimer);
        const error = new Error("No se pudo conectar con el servidor. Verifica que el backend esté encendido (node server.js en la carpeta backend).");
        error.status = 0;
        throw error;
    }

    clearTimeout(wakeUpTimer);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        // Token vencido o inválido mientras se usa la app
        if (response.status === 401 && currentUser) {
            handleExpiredSession();
        }
        const error = new Error(data.mensaje || "Ocurrió un error al conectar con MoneyMentor.");
        error.status = response.status;
        throw error;
    }

    return data;
}

const DEMO_EMAIL = "demo@moneymentor.mx";
const DEMO_PASSWORD = "demo12345";
const MIN_PASSWORD = 8;

const CATEGORIES = {
    income: ["Salario", "Ahorro", "Ventas", "Beca", "Otros ingresos"],
    expense: ["Alimentación", "Transporte", "Servicios", "Entretenimiento", "Salud", "Educación", "Otros"]
};

const GOAL_ICONS = ["star", "plane", "home", "laptop", "car", "gift", "shield", "wallet"];
const LEGACY_ICONS = { "✈": "plane", "⌂": "home", "▣": "laptop", "☆": "star" };

const TOPICS = [
    { id: "t1", category: "basics", icon: "chart", level: "Básico", minutes: 5,
      title: "¿Qué es el interés compuesto?",
      body: "El interés compuesto ocurre cuando los intereses que ganas se suman a tu ahorro inicial y también comienzan a generar intereses. Con el tiempo, esto puede ayudarte a hacer crecer tu dinero.",
      tip: "Prueba el simulador de inversión con 1,000 al mes durante 60 meses y una tasa del 10% para verlo en acción." },
    { id: "t2", category: "basics", icon: "calc", level: "Básico", minutes: 7,
      title: "Cómo hacer un presupuesto",
      body: "Un presupuesto es un plan para organizar tus ingresos y gastos. Primero identifica cuánto dinero recibes, después registra tus gastos y finalmente establece cuánto puedes ahorrar.",
      tip: "Una regla sencilla para empezar: 50% necesidades, 30% gustos y 20% ahorro." },
    { id: "t3", category: "investment", icon: "up", level: "Intermedio", minutes: 8,
      title: "Tipos de inversión",
      body: "Existen diferentes instrumentos de inversión, como CETES, fondos de inversión y acciones. Antes de invertir, identifica tu objetivo, plazo y tolerancia al riesgo.",
      tip: "A mayor rendimiento esperado, normalmente hay mayor riesgo. Diversificar reduce el impacto de una mala inversión." },
    { id: "t4", category: "saving", icon: "card", level: "Básico", minutes: 6,
      title: "Evita el sobreendeudamiento",
      body: "Antes de solicitar un crédito, revisa tu capacidad de pago, las tasas de interés y el costo total. Procura no comprometer todo tu ingreso mensual.",
      tip: "Como referencia, tus pagos de deudas no deberían superar el 30% de tu ingreso mensual." },
    { id: "t5", category: "saving", icon: "shield", level: "Básico", minutes: 5,
      title: "Fondo de emergencia",
      body: "Un fondo de emergencia te ayuda a enfrentar gastos inesperados. Puedes comenzar con una pequeña cantidad semanal y aumentar tu ahorro poco a poco.",
      tip: "La meta recomendada es juntar el equivalente a 3 a 6 meses de tus gastos básicos." }
];

let currentUser = null;
let movements = [];
let goals = [];
let notifications = [];

let movementFilter = "all";
let notifFilter = "all";
let selectedMonth = new Date();
let simulatorType = "saving";
let currentSection = "homeSection";

/* ==========================================
   ALMACENAMIENTO
   Los datos financieros viven en MySQL. En el navegador solo quedan
   el token de sesión y las notificaciones (preferencia local).
========================================== */

function loadData(key, fallback) {
    try {
        const data = JSON.parse(localStorage.getItem(key));
        return data === null ? fallback : data;
    } catch {
        return fallback;
    }
}

function saveData(key, data) {
    try {
        localStorage.setItem(key, JSON.stringify(data));
    } catch {
        toast("No se pudo guardar. Revisa el espacio de tu navegador.", "error");
    }
}

const userKey = name => `moneymentor_${name}_${currentUser.id}`;

function saveNotifications() { saveData(userKey("notifications"), notifications); }

/* Borra los datos que el prototipo anterior guardaba en el navegador */
function cleanupLegacyStorage() {
    [USERS_KEY, SESSION_KEY, LEGACY_MOVEMENTS_KEY, LEGACY_GOALS_KEY].forEach(key => {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    });
    Object.keys(localStorage)
        .filter(key => /^moneymentor_(movements|goals)_/.test(key))
        .forEach(key => localStorage.removeItem(key));
}

/* Convierte el usuario de MySQL al formato que usa la interfaz */
function mapUserFromApi(u) {
    const flag = value => Boolean(Number(value));
    return {
        id: String(u.id),
        name: u.nombre,
        email: u.correo,
        objective: u.objetivo || "Ahorrar",
        monthlyIncome: Number(u.ingreso_mensual) || 0,
        debts: (Number(u.deudas) > 0 || u.deudas === "Sí") ? "Sí" : "No",
        interests: (u.intereses || "").split(",").map(item => item.trim()).filter(Boolean),
        notificationsOn: u.notificaciones_activadas === null || u.notificaciones_activadas === undefined
            ? true
            : flag(u.notificaciones_activadas),
        setupCompleted: flag(u.setup_completado),
        tourCompleted: flag(u.tour_completado)
    };
}

function mapMovementFromApi(m) {
    return {
        id: String(m.id),
        type: m.type,
        amount: Number(m.amount),
        category: m.category,
        date: m.date,
        description: m.description
    };
}

/* Carga movimientos y metas del usuario autenticado */
async function loadFinancialData() {
    const [movementData, goalData] = await Promise.all([
        apiRequest("/movements"),
        apiRequest("/goals")
    ]);

    movements = (movementData.movimientos || []).map(mapMovementFromApi);
    goals = (goalData.metas || []).map(goal => ({ ...goal, icon: goal.icon || "star" }));
    notifications = loadData(userKey("notifications"), []);
}

/* Guarda en MySQL solo los campos del perfil que se envían */
function saveProfile(fields) {
    return apiRequest("/users/profile", {
        method: "PUT",
        body: JSON.stringify(fields)
    });
}

/* ==========================================
   UTILIDADES DE INTERFAZ
========================================== */

const $ = id => document.getElementById(id);
const icon = (name, cls = "icon") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;

function toast(message, type = "success", action) {
    const icons = { success: "check", error: "alert", warning: "alert", info: "bell" };
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `${icon(icons[type] || "check")}<span>${escapeHTML(message)}</span>`;

    if (action) {
        const btn = document.createElement("button");
        btn.className = "toast-action";
        btn.textContent = action.label;
        btn.addEventListener("click", () => { action.onClick(); dismiss(); });
        el.appendChild(btn);
    }

    $("toastStack").appendChild(el);
    const timer = setTimeout(dismiss, action ? 5000 : 3200);

    function dismiss() {
        clearTimeout(timer);
        el.classList.add("out");
        setTimeout(() => el.remove(), 200);
    }
}

/* Modal reutilizable.
   onConfirm puede regresar false para mantener el modal abierto (validación). */
let modalHandler = null;

function openModal({ title, body, confirmText = "Guardar", cancelText = "Cancelar", danger = false, onConfirm, hideCancel = false }) {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = body;
    $("modalConfirm").textContent = confirmText;
    $("modalConfirm").classList.toggle("is-danger", danger);
    $("modalCancel").textContent = cancelText;
    $("modalCancel").classList.toggle("hidden", hideCancel);
    $("modalActions").classList.toggle("single", hideCancel);
    modalHandler = onConfirm || null;

    $("modal").showModal();

    const firstInput = $("modalBody").querySelector("input:not([type=radio]), select, textarea");
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeModal() {
    $("modal").close();
    modalHandler = null;
}

/* Para modales que guardan en el servidor: deja el modal abierto mientras
   responde la API y lo cierra solo si la operación fue correcta.
   La acción puede regresar false para mantenerlo abierto. */
function runModalAction(action) {
    const button = $("modalConfirm");
    setLoading(button, true);
    Promise.resolve()
        .then(action)
        .then(result => { if (result !== false) closeModal(); })
        .catch(error => toast(error.message, "error"))
        .finally(() => setLoading(button, false));
    return false;
}

function confirmDialog({ title, message, confirmText = "Eliminar", danger = true }) {
    return new Promise(resolve => {
        openModal({
            title,
            body: `<p>${escapeHTML(message)}</p>`,
            confirmText,
            danger,
            onConfirm: () => { resolve(true); }
        });
        $("modal").addEventListener("close", () => resolve(false), { once: true });
    });
}

$("modalForm").addEventListener("submit", event => {
    event.preventDefault();
    if (modalHandler && modalHandler() === false) return;
    closeModal();
});
$("modalCancel").addEventListener("click", closeModal);
$("modalClose").addEventListener("click", closeModal);
$("modal").addEventListener("click", event => {
    if (event.target === $("modal")) closeModal(); // clic fuera del contenido
});

function setFieldError(inputId, message) {
    const input = $(inputId);
    const error = $(inputId + "Error");
    if (input) {
        input.classList.toggle("invalid", Boolean(message));
        input.setAttribute("aria-invalid", message ? "true" : "false");
    }
    if (error) error.textContent = message || "";
}

function clearErrors(form) {
    form.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
    form.querySelectorAll(".field-error").forEach(el => el.textContent = "");
}

function setLoading(button, loading) {
    button.classList.toggle("is-loading", loading);
    button.disabled = loading;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/* ==========================================
   CONTRASEÑAS
========================================== */

function passwordStrength(password) {
    if (!password) return 0;
    let score = 0;
    if (password.length >= MIN_PASSWORD) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;
    else if (/\d/.test(password) && score < 4) score += 0.5;
    return Math.max(1, Math.min(4, Math.floor(score)));
}

const isValidEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

/* ==========================================
   PANTALLAS
========================================== */

function showScreen(id) {
    ["loginScreen", "setupScreen", "appScreen"].forEach(screen => $(screen).classList.add("hidden"));
    $(id).classList.remove("hidden");
    document.body.classList.toggle("in-app", id === "appScreen");
    // Las animaciones de paneles se activan después de mostrar la app
    $("appScreen").classList.remove("anim-ready");
    if (id === "appScreen") setTimeout(() => $("appScreen").classList.add("anim-ready"), 400);
    window.scrollTo(0, 0);
}

function switchAuthTab(tab) {
    const isLogin = tab === "login";
    $("tabLogin").classList.toggle("active", isLogin);
    $("tabRegister").classList.toggle("active", !isLogin);
    $("tabLogin").setAttribute("aria-selected", isLogin);
    $("tabRegister").setAttribute("aria-selected", !isLogin);
    document.querySelector(".auth-tabs").dataset.active = tab;
    $("loginForm").classList.toggle("hidden", !isLogin);
    $("registerForm").classList.toggle("hidden", isLogin);
    $("loginAlert").classList.add("hidden");
    setTimeout(() => $(isLogin ? "loginEmail" : "registerName").focus(), 30);
}

$("tabLogin").addEventListener("click", () => switchAuthTab("login"));
$("tabRegister").addEventListener("click", () => switchAuthTab("register"));

// Mostrar / ocultar contraseña
document.querySelectorAll(".toggle-pass").forEach(button => {
    button.addEventListener("click", () => {
        const input = $(button.dataset.target);
        const show = input.type === "password";
        input.type = show ? "text" : "password";
        button.innerHTML = icon(show ? "eye-off" : "eye");
        button.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
    });
});

// Indicador de seguridad
$("registerPassword").addEventListener("input", function () {
    const level = passwordStrength(this.value);
    const labels = [`Usa ${MIN_PASSWORD} caracteres o más`, "Débil", "Aceptable", "Buena", "Muy segura"];
    const box = $("passStrength");
    box.dataset.level = this.value.length < MIN_PASSWORD && this.value ? 1 : level;
    box.querySelector(".strength-text").textContent =
        this.value && this.value.length < MIN_PASSWORD ? "Muy corta" : labels[level];
});

// Limpiar error al escribir
document.querySelectorAll(".auth-form input, #movementForm input").forEach(input => {
    input.addEventListener("input", () => setFieldError(input.id, ""));
});

/* ==========================================
   REGISTRO
========================================== */

$("registerForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    clearErrors(this);

    const name = $("registerName").value.trim();
    const email = $("registerEmail").value.trim().toLowerCase();
    const password = $("registerPassword").value;
    const confirm = $("confirmPassword").value;
    let ok = true;

    if (name.length < 2) { setFieldError("registerName", "Escribe tu nombre."); ok = false; }
    if (!isValidEmail(email)) { setFieldError("registerEmail", "Escribe un correo válido, por ejemplo nombre@correo.com."); ok = false; }
    if (password.length < MIN_PASSWORD) { setFieldError("registerPassword", `La contraseña necesita al menos ${MIN_PASSWORD} caracteres.`); ok = false; }
    if (password !== confirm) { setFieldError("confirmPassword", "Las contraseñas no coinciden."); ok = false; }

    if (!ok) {
        this.querySelector(".invalid")?.focus();
        return;
    }

    const button = this.querySelector("[type=submit]");
    setLoading(button, true);

    try {
        const data = await apiRequest("/auth/register", {
            method: "POST",
            body: JSON.stringify({ nombre: name, correo: email, password })
        });

        this.reset();
        $("passStrength").dataset.level = 0;

        // Entra directo, sin volver a pedir el correo y la contraseña
        await startSession(data.token, true);
    } catch (error) {
        if (error.status === 409) {
            setFieldError("registerEmail", "Este correo ya tiene una cuenta. Inicia sesión.");
            $("registerEmail").focus();
        } else {
            toast(error.message, "error");
        }
    } finally {
        setLoading(button, false);
    }
});

/* ==========================================
   INICIO DE SESIÓN
========================================== */

function showLoginAlert(message) {
    const alertBox = $("loginAlert");
    alertBox.innerHTML = `${icon("alert")}<span>${message}</span>`;
    alertBox.classList.remove("hidden");
}

$("loginForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    clearErrors(this);
    $("loginAlert").classList.add("hidden");

    const email = $("loginEmail").value.trim().toLowerCase();
    const password = $("loginPassword").value;
    let ok = true;

    if (!isValidEmail(email)) { setFieldError("loginEmail", "Escribe un correo válido."); ok = false; }
    if (!password) { setFieldError("loginPassword", "Escribe tu contraseña."); ok = false; }
    if (!ok) { this.querySelector(".invalid")?.focus(); return; }

    const button = this.querySelector("[type=submit]");
    setLoading(button, true);

    try {
        const data = await apiRequest("/auth/login", {
            method: "POST",
            body: JSON.stringify({ correo: email, password })
        });
        await startSession(data.token, $("rememberMe").checked);
    } catch (error) {
        if (error.status === 401) {
            showLoginAlert(`El correo o la contraseña no son correctos. ¿Aún no tienes cuenta? <button type="button" class="link-btn" id="alertToRegister">Crear cuenta</button>`);
            $("alertToRegister").addEventListener("click", () => {
                switchAuthTab("register");
                $("registerEmail").value = email;
            });
            $("loginPassword").select();
        } else {
            showLoginAlert(escapeHTML(error.message));
        }
    } finally {
        setLoading(button, false);
    }
});

$("forgotBtn").addEventListener("click", () => {
    openModal({
        title: "Recuperar contraseña",
        body: `<p>La recuperación de contraseña por correo todavía no está disponible en esta versión de MoneyMentor.</p>
               <p style="margin-top:10px">Si ya iniciaste sesión en otro dispositivo, puedes cambiarla desde <b>Mi perfil</b>. También puedes crear una cuenta nueva o entrar con la cuenta de prueba.</p>`,
        confirmText: "Entendido",
        hideCancel: true
    });
});

/* Cuenta de prueba con datos de ejemplo (se guarda en MySQL como cualquier cuenta) */
async function seedDemoAccount() {
    const d = offset => {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        return toISODate(date);
    };

    await saveProfile({
        objetivo: "Ahorrar",
        ingreso_mensual: 14000,
        deudas: 0,
        intereses: "Ahorro, Inversión",
        notificaciones_activadas: 1,
        setup_completado: 1
    });

    const sampleMovements = [
        { type: "income", amount: 7000, category: "Salario", date: d(6), description: "Pago quincenal" },
        { type: "expense", amount: 260, category: "Entretenimiento", date: d(5), description: "Cine con amigos" },
        { type: "expense", amount: 450, category: "Servicios", date: d(4), description: "Internet y teléfono" },
        { type: "income", amount: 1500, category: "Ahorro", date: d(2), description: "Apartado para mi meta" },
        { type: "expense", amount: 180, category: "Transporte", date: d(1), description: "Recarga de transporte" },
        { type: "expense", amount: 320, category: "Alimentación", date: d(0), description: "Despensa semanal" }
    ];
    for (const movement of sampleMovements) {
        await apiRequest("/movements", { method: "POST", body: JSON.stringify(movement) });
    }

    const sampleGoals = [
        { name: "Laptop nueva", icon: "laptop", saved: 3200, target: 20000 },
        { name: "Viaje a la playa", icon: "plane", saved: 4200, target: 15000 },
        { name: "Fondo de emergencia", icon: "shield", saved: 6800, target: 10000 }
    ];
    for (const goal of sampleGoals) {
        await apiRequest("/goals", { method: "POST", body: JSON.stringify(goal) });
    }
}

$("demoBtn").addEventListener("click", async function () {
    setLoading(this, true);
    try {
        let token;
        try {
            const data = await apiRequest("/auth/login", {
                method: "POST",
                body: JSON.stringify({ correo: DEMO_EMAIL, password: DEMO_PASSWORD })
            });
            token = data.token;
        } catch (error) {
            if (error.status !== 401) throw error;

            // La cuenta de prueba aún no existe: se crea con datos de ejemplo
            const data = await apiRequest("/auth/register", {
                method: "POST",
                body: JSON.stringify({ nombre: "Alex Demo", correo: DEMO_EMAIL, password: DEMO_PASSWORD })
            });
            token = data.token;
            saveAuthToken(token, false);
            await seedDemoAccount();
        }

        await startSession(token, false);
        toast("Estás usando la cuenta de prueba.", "info");
    } catch (error) {
        clearAuthToken();
        toast(error.message, "error");
    } finally {
        setLoading(this, false);
    }
});

/* ==========================================
   SESIÓN
========================================== */

/* Consulta el usuario del token y descarga sus datos desde MySQL */
async function loadSession() {
    const { usuario } = await apiRequest("/auth/me");
    currentUser = mapUserFromApi(usuario);
    await loadFinancialData();
}

async function startSession(token, remember) {
    saveAuthToken(token, remember);
    await loadSession();

    $("loginForm").reset();
    $("rememberMe").checked = true;

    if (!currentUser.setupCompleted) startSetup();
    else enterApp();
}

/* Al abrir la app: valida el token guardado con GET /api/auth/me */
async function restoreSession() {
    if (!getAuthToken()) return false;

    try {
        await loadSession();
    } catch (error) {
        currentUser = null;
        if (error.status === 0) {
            // Servidor apagado: se conserva el token para intentarlo después
            showScreen("loginScreen");
            showLoginAlert(escapeHTML(error.message));
        } else {
            clearAuthToken();
        }
        return false;
    }

    currentUser.setupCompleted ? enterApp() : startSetup();
    return true;
}

function resetSessionState() {
    clearAuthToken();
    currentUser = null;
    movements = [];
    goals = [];
    notifications = [];
    resetAIChat();
    closeOverlays();
    if ($("modal").open) closeModal();
    $("tourOverlay").classList.add("hidden");
    showScreen("loginScreen");
    switchAuthTab("login");
}

function logout() {
    resetSessionState();
    toast("Cerraste sesión.", "info");
}

function handleExpiredSession() {
    resetSessionState();
    showLoginAlert("Tu sesión expiró. Inicia sesión de nuevo.");
}

document.querySelectorAll("[data-logout]").forEach(button => {
    button.addEventListener("click", async () => {
        closeOverlays();
        const ok = await confirmDialog({
            title: "¿Cerrar sesión?",
            message: "Tus datos quedan guardados en tu cuenta. Podrás verlos al iniciar sesión desde cualquier dispositivo.",
            confirmText: "Cerrar sesión"
        });
        if (ok) logout();
    });
});

/* ==========================================
   CONFIGURACIÓN INICIAL (3 PASOS)
========================================== */

let setupStep = 1;
const SETUP_STEPS = 3;

function startSetup() {
    setupStep = 1;
    $("setupHello").textContent = `¡Hola, ${currentUser.name.split(" ")[0]}! ¿Qué quieres lograr?`;
    renderSetupStep();
    showScreen("setupScreen");
}

function renderSetupStep() {
    document.querySelectorAll(".setup-step").forEach(step => {
        step.classList.toggle("active", Number(step.dataset.step) === setupStep);
    });
    $("stepCount").textContent = `Paso ${setupStep} de ${SETUP_STEPS}`;
    $("stepBar").style.width = (setupStep / SETUP_STEPS * 100) + "%";
    $("setupBack").hidden = setupStep === 1;
    $("setupNext").textContent = setupStep === SETUP_STEPS ? "Empezar" : "Continuar";
}

$("setupBack").addEventListener("click", () => {
    if (setupStep > 1) { setupStep--; renderSetupStep(); }
});

document.querySelectorAll(".interest").forEach(button => {
    button.addEventListener("click", () => {
        const selected = button.classList.toggle("selected");
        button.setAttribute("aria-pressed", selected);
    });
});

$("setupForm").addEventListener("submit", async function (event) {
    event.preventDefault();

    if (setupStep < SETUP_STEPS) {
        setupStep++;
        renderSetupStep();
        return;
    }

    const profile = {
        objective: this.querySelector("[name=objective]:checked").value,
        monthlyIncome: Number($("monthlyIncome").value) || 0,
        debts: this.querySelector("[name=debts]:checked").value,
        interests: [...document.querySelectorAll(".interest.selected")].map(b => b.textContent.trim())
    };

    const button = $("setupNext");
    setLoading(button, true);

    try {
        await saveProfile({
            objetivo: profile.objective,
            ingreso_mensual: profile.monthlyIncome,
            deudas: profile.debts === "Sí" ? 1 : 0,
            intereses: profile.interests.join(", "),
            setup_completado: 1
        });
        Object.assign(currentUser, profile, { setupCompleted: true });
        enterApp(true);
    } catch (error) {
        toast(error.message, "error");
    } finally {
        setLoading(button, false);
    }
});

/* ==========================================
   ENTRAR A LA APLICACIÓN
========================================== */

function enterApp(isFirstTime = false) {
    // Los datos ya se descargaron de MySQL en loadSession()
    showScreen("appScreen");
    fillUserInfo();

    $("movementDate").value = getToday();
    fillCategories("expense");
    renderTopics();

    if (isFirstTime) {
        addNotification({
            key: "welcome", type: "info", icon: "spark",
            title: "Bienvenido a MoneyMentor",
            body: "Empieza registrando tu primer ingreso o gasto para ver tu salud financiera.",
            action: { label: "Registrar movimiento", section: "movementsSection" }
        }, true);
    }
    runSmartChecks();

    renderAll();
    showSection("homeSection");
    renderNotifications();

    if (isFirstTime || !currentUser.tourCompleted) {
        setTimeout(() => startTour(), 450);
    }
}

function fillUserInfo() {
    const firstName = currentUser.name.split(" ")[0];
    const initial = firstName.charAt(0).toUpperCase();

    $("homeGreeting").textContent = `${greetingByHour()}, ${firstName}`;
    document.querySelectorAll("[data-avatar]").forEach(el => el.textContent = initial);
    document.querySelectorAll("[data-username]").forEach(el => el.textContent = currentUser.name);
    document.querySelectorAll("[data-useremail]").forEach(el => el.textContent = currentUser.email);

    $("profileObjective").textContent = currentUser.objective || "Ahorrar";
    $("profileMonthly").textContent = formatMoney(currentUser.monthlyIncome || 0);
    $("profileDebts").textContent = currentUser.debts || "No";
    $("profileInterests").textContent = (currentUser.interests || []).join(", ") || "Sin elegir";
    $("notifToggle").checked = currentUser.notificationsOn !== false;
}

function greetingByHour() {
    const hour = new Date().getHours();
    if (hour < 12) return "Buenos días";
    if (hour < 19) return "Buenas tardes";
    return "Buenas noches";
}

/* ==========================================
   NAVEGACIÓN
========================================== */

function showSection(sectionId) {
    currentSection = sectionId;
    document.querySelectorAll(".section").forEach(section => {
        section.classList.toggle("active", section.id === sectionId);
    });

    // Barra lateral, barra inferior y hoja "Más"
    const inMore = ["simulatorSection", "assistantSection", "aiSection", "profileSection"].includes(sectionId);
    document.querySelectorAll(".nav-link, .nav-item").forEach(button => {
        const active = button.dataset.section === sectionId || (inMore && button.hasAttribute("data-more"));
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
    });

    $("headerTitle").textContent = $(sectionId).dataset.title || "";

    if (sectionId === "movementsSection") renderMovements();
    if (sectionId === "goalsSection") renderGoals();
    if (sectionId === "homeSection") renderHome();
    if (sectionId === "aiSection") prepareAISection();

    closeOverlays();
    window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link, .nav-item[data-section], .sheet-item[data-section]").forEach(button => {
    button.addEventListener("click", () => showSection(button.dataset.section));
});

document.addEventListener("click", event => {
    const go = event.target.closest("[data-go]");
    if (go) showSection(go.dataset.go);
});

/* Hoja "Más" y panel de notificaciones */
function openSheet() {
    closeNotifications();
    $("moreSheet").classList.add("open");
    $("moreSheet").setAttribute("aria-hidden", "false");
    $("scrim").className = "scrim show";
}

function closeOverlays() {
    $("moreSheet").classList.remove("open");
    $("moreSheet").setAttribute("aria-hidden", "true");
    closeNotifications();
}

$("moreBtn").addEventListener("click", () => {
    $("moreSheet").classList.contains("open") ? closeOverlays() : openSheet();
});
$("scrim").addEventListener("click", closeOverlays);
document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeOverlays();
});

/* Accesos rápidos de inicio */
document.querySelectorAll("[data-quick]").forEach(button => {
    button.addEventListener("click", () => {
        showSection("movementsSection");
        const type = button.dataset.quick;
        document.querySelector(`[name=movementType][value=${type}]`).checked = true;
        fillCategories(type);
        const card = $("movementFormCard");
        setTimeout(() => {
            card.scrollIntoView({ behavior: "smooth", block: "start" });
            card.classList.remove("flash");
            void card.offsetWidth;
            card.classList.add("flash");
            $("movementAmount").focus({ preventScroll: true });
        }, 120);
    });
});

/* ==========================================
   FORMATO Y FECHAS
========================================== */

function formatMoney(amount) {
    return Number(amount).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

function toISODate(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function getToday() { return toISODate(new Date()); }

function formatMonth(date) {
    const text = date.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatShortDate(iso) {
    const date = new Date(iso + "T12:00:00");
    const today = new Date(getToday() + "T12:00:00");
    const diff = Math.round((today - date) / 86400000);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Ayer";
    return date.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "Hace un momento";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "Ayer";
    if (days < 7) return `Hace ${days} días`;
    return new Date(timestamp).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

/* ==========================================
   RESUMEN FINANCIERO
========================================== */

function sumBy(list, type) {
    return list.filter(item => item.type === type).reduce((sum, item) => sum + Number(item.amount), 0);
}

function getTotals(list = movements) {
    const income = sumBy(list, "income");
    const expenses = sumBy(list, "expense");
    const savings = list
        .filter(item => item.type === "income" && item.category === "Ahorro")
        .reduce((sum, item) => sum + Number(item.amount), 0);
    return { income, expenses, savings, balance: income - expenses };
}

function getMonthMovements(date = new Date()) {
    return movements.filter(item => {
        const d = new Date(item.date + "T12:00:00");
        return d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear();
    });
}

function getScore(totals) {
    return totals.income > 0
        ? Math.max(0, Math.min(100, Math.round((totals.balance / totals.income) * 100)))
        : 0;
}

function paintDonut(element, income, expenses) {
    const total = income + expenses;
    if (!total) {
        element.style.background = "conic-gradient(#e8eef3 0deg 360deg)";
        return;
    }
    const deg = (income / total) * 360;
    element.style.background = `conic-gradient(var(--green-soft) 0deg ${deg}deg, #2c78a9 ${deg}deg 360deg)`;
}

/* ==========================================
   INICIO
========================================== */

function renderHome() {
    const totals = getTotals();
    const score = getScore(totals);

    $("homeBalance").textContent = formatMoney(totals.balance);
    $("heroScore").textContent = score;
    $("homeIncome").textContent = formatMoney(totals.income);
    $("homeExpenses").textContent = formatMoney(totals.expenses);
    $("homeSavings").textContent = formatMoney(totals.savings);

    paintDonut($("healthDonut"), totals.income, totals.expenses);
    $("healthScore").textContent = score + "/100";
    $("healthLabel").textContent = !totals.income ? "Sin datos" : score >= 60 ? "Buena" : score >= 30 ? "Regular" : "Por mejorar";

    const mainGoal = goals[0];
    const goalBox = $("homeGoal");
    if (mainGoal) {
        const progress = Math.min((mainGoal.saved / mainGoal.target) * 100, 100);
        goalBox.innerHTML = `
            <div class="goal-icon">${icon(mainGoal.icon)}</div>
            <div class="goal-info">
                <strong>${escapeHTML(mainGoal.name)}</strong>
                <p>${formatMoney(mainGoal.saved)} de ${formatMoney(mainGoal.target)}</p>
                <div class="progress-track"><div class="progress-fill ${progress >= 100 ? "done" : ""}" style="width:${progress}%"></div></div>
            </div>`;
    } else {
        goalBox.innerHTML = `
            <div class="goal-icon">${icon("target")}</div>
            <div class="goal-info"><strong>Sin metas todavía</strong><p>Crea una meta para seguir tu avance aquí.</p></div>`;
    }

    let recommendation = "Registra tus movimientos para recibir recomendaciones sobre tus finanzas.";
    if (totals.income > 0 && totals.expenses > totals.income * .7) {
        recommendation = "Tus gastos representan una parte importante de tus ingresos. Revisa tus compras y establece un límite para tus gastos variables.";
    } else if (totals.income > 0 && totals.balance > 0) {
        recommendation = "¡Vas por buen camino! Tu balance es positivo. Considera destinar una parte a tu meta de ahorro.";
    } else if (totals.income > 0 && totals.balance <= 0) {
        recommendation = "Tus gastos alcanzan o superan tus ingresos. Revisa qué gastos puedes reducir.";
    }
    $("homeRecommendation").textContent = recommendation;

    const recent = movements.slice(0, 4);
    $("homeRecentMovements").innerHTML = recent.length
        ? recent.map(movementHTML).join("")
        : emptyState("swap", "Aún no hay movimientos", "Registra tu primer ingreso o gasto para ver tu resumen.", "Registrar movimiento", "movementsSection");
}

function emptyState(iconName, title, text, cta, section) {
    return `
        <div class="empty-state">
            <div class="empty-icon">${icon(iconName)}</div>
            <strong>${title}</strong>
            <p>${text}</p>
            ${cta ? `<button type="button" class="secondary-btn" data-go="${section}">${cta}</button>` : ""}
        </div>`;
}

/* ==========================================
   MOVIMIENTOS
========================================== */

function fillCategories(type, selected) {
    const select = $("movementCategory");
    select.innerHTML = CATEGORIES[type].map(c => `<option ${c === selected ? "selected" : ""}>${c}</option>`).join("");
}

document.querySelectorAll("[name=movementType]").forEach(radio => {
    radio.addEventListener("change", () => fillCategories(radio.value));
});

function movementHTML(item) {
    const isIncome = item.type === "income";
    return `
        <div class="movement-item">
            <div class="movement-icon ${isIncome ? "inc" : "exp"}">${icon(isIncome ? "up" : "down")}</div>
            <div class="movement-info">
                <strong>${escapeHTML(item.description)}</strong>
                <small>${escapeHTML(item.category)} · ${formatShortDate(item.date)}</small>
            </div>
            <div class="movement-right">
                <span class="movement-amount ${isIncome ? "amount-income" : "amount-expense"}">${isIncome ? "+" : "−"}${formatMoney(item.amount)}</span>
                <span class="movement-actions-inline">
                <button class="row-btn" type="button" onclick="editMovement('${item.id}')" aria-label="Editar ${escapeHTML(item.description)}" title="Editar">${icon("edit")}</button>
                <button class="row-btn del" type="button" onclick="deleteMovement('${item.id}')" aria-label="Eliminar ${escapeHTML(item.description)}" title="Eliminar">${icon("trash")}</button>
                </span>
            </div>
        </div>`;
}

function renderMovements() {
    $("currentMonth").textContent = formatMonth(selectedMonth);

    const monthMovements = getMonthMovements(selectedMonth)
        .sort((a, b) => b.date.localeCompare(a.date));
    const { income, expenses } = getTotals(monthMovements);
    const spentPct = income ? Math.round((expenses / income) * 100) : 0;

    $("movementIncome").textContent = formatMoney(income);
    $("movementExpenses").textContent = formatMoney(expenses);
    $("movementTotal").textContent = income ? spentPct + "%" : "—";
    $("legendIncome").textContent = formatMoney(income);
    $("legendExpenses").textContent = formatMoney(expenses);
    $("legendBalance").textContent = formatMoney(income - expenses);
    paintDonut($("monthDonut"), income, expenses);

    const filtered = movementFilter === "all"
        ? monthMovements
        : monthMovements.filter(item => item.type === movementFilter);

    $("movementList").innerHTML = filtered.length
        ? filtered.map(movementHTML).join("")
        : `<p class="empty-message">No hay movimientos en ${formatMonth(selectedMonth)}.</p>`;
}

function changeMonth(amount) {
    selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + amount, 1);
    renderMovements();
}

document.querySelectorAll("#movementTabs button").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll("#movementTabs button").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        movementFilter = button.dataset.filter;
        renderMovements();
    });
});

/* Quita un movimiento recién creado (botón "Deshacer") */
async function undoNewMovement(id) {
    try {
        await apiRequest(`/movements/${id}`, { method: "DELETE" });
        movements = movements.filter(item => item.id !== id);
        renderAll();
    } catch (error) {
        toast(error.message, "error");
    }
}

$("movementForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    clearErrors(this);

    const amount = Number($("movementAmount").value);
    const description = $("movementDescription").value.trim();
    const date = $("movementDate").value || getToday();
    const type = this.querySelector("[name=movementType]:checked").value;
    let ok = true;

    if (!Number.isFinite(amount) || amount <= 0) { setFieldError("movementAmount", "Escribe una cantidad mayor a cero."); ok = false; }
    if (!description) { setFieldError("movementDescription", "Agrega una descripción corta."); ok = false; }
    if (!ok) { this.querySelector(".invalid")?.focus(); return; }

    const data = {
        type, amount,
        category: $("movementCategory").value,
        date, description
    };

    const button = this.querySelector("[type=submit]");
    setLoading(button, true);

    try {
        const result = await apiRequest("/movements", {
            method: "POST",
            body: JSON.stringify(data)
        });

        const movement = { id: String(result.id), ...data };
        movements.unshift(movement);

        this.reset();
        document.querySelector(`[name=movementType][value=${type}]`).checked = true;
        fillCategories(type);
        $("movementDate").value = getToday();

        // Mostrar el mes del movimiento guardado
        const d = new Date(date + "T12:00:00");
        selectedMonth = new Date(d.getFullYear(), d.getMonth(), 1);

        renderAll();
        runSmartChecks();

        toast(type === "income" ? "Ingreso guardado" : "Gasto guardado", "success", {
            label: "Deshacer",
            onClick: () => undoNewMovement(movement.id)
        });
    } catch (error) {
        toast(error.message, "error");
    } finally {
        setLoading(button, false);
    }
});

function movementFormHTML(item) {
    const options = type => CATEGORIES[type].map(c => `<option ${c === item.category ? "selected" : ""}>${c}</option>`).join("");
    return `
        <div class="type-toggle">
            <label><input type="radio" name="mType" value="expense" ${item.type === "expense" ? "checked" : ""}><span>${icon("down")}Gasto</span></label>
            <label><input type="radio" name="mType" value="income" ${item.type === "income" ? "checked" : ""}><span>${icon("up")}Ingreso</span></label>
        </div>
        <div class="form-row">
            <div class="field">
                <label for="mAmount">Cantidad</label>
                <div class="input-wrap money-input"><span class="input-prefix">$</span>
                <input type="number" id="mAmount" min="0.01" step="0.01" inputmode="decimal" value="${item.amount}"></div>
                <p class="field-error" id="mAmountError"></p>
            </div>
            <div class="field">
                <label for="mDate">Fecha</label>
                <input type="date" id="mDate" value="${item.date}">
            </div>
        </div>
        <div class="field">
            <label for="mCategory">Categoría</label>
            <select id="mCategory">${options(item.type)}</select>
        </div>
        <div class="field">
            <label for="mDescription">Descripción</label>
            <input type="text" id="mDescription" maxlength="60" value="${escapeHTML(item.description)}">
            <p class="field-error" id="mDescriptionError"></p>
        </div>`;
}

function editMovement(id) {
    const item = movements.find(movement => movement.id === id);
    if (!item) return;

    openModal({
        title: "Editar movimiento",
        body: movementFormHTML(item),
        confirmText: "Guardar cambios",
        onConfirm: () => {
            const amount = Number($("mAmount").value);
            const description = $("mDescription").value.trim();
            let ok = true;
            setFieldError("mAmount", ""); setFieldError("mDescription", "");
            if (!Number.isFinite(amount) || amount <= 0) { setFieldError("mAmount", "Escribe una cantidad mayor a cero."); ok = false; }
            if (!description) { setFieldError("mDescription", "Agrega una descripción."); ok = false; }
            if (!ok) return false;

            const updated = {
                type: document.querySelector("[name=mType]:checked").value,
                amount,
                description,
                date: $("mDate").value || item.date,
                category: $("mCategory").value
            };

            return runModalAction(async () => {
                await apiRequest(`/movements/${item.id}`, {
                    method: "PUT",
                    body: JSON.stringify(updated)
                });
                Object.assign(item, updated);
                renderAll();
                toast("Cambios guardados");
            });
        }
    });

    document.querySelectorAll("[name=mType]").forEach(radio => {
        radio.addEventListener("change", () => {
            $("mCategory").innerHTML = CATEGORIES[radio.value].map(c => `<option>${c}</option>`).join("");
        });
    });
}

async function deleteMovement(id) {
    const index = movements.findIndex(item => item.id === id);
    if (index === -1) return;
    const item = movements[index];

    const ok = await confirmDialog({
        title: "¿Eliminar movimiento?",
        message: `Se eliminará "${item.description}" por ${formatMoney(item.amount)}.`
    });
    if (!ok) return;

    try {
        await apiRequest(`/movements/${item.id}`, { method: "DELETE" });
    } catch (error) {
        toast(error.message, "error");
        return;
    }

    movements = movements.filter(movement => movement.id !== item.id);
    renderAll();

    toast("Movimiento eliminado", "success", {
        label: "Deshacer",
        onClick: async () => {
            try {
                const { id, ...data } = item;
                const result = await apiRequest("/movements", {
                    method: "POST",
                    body: JSON.stringify(data)
                });
                movements.splice(Math.min(index, movements.length), 0, { ...data, id: String(result.id) });
                renderAll();
            } catch (error) {
                toast(error.message, "error");
            }
        }
    });
}

/* ==========================================
   METAS FINANCIERAS
========================================== */

function renderGoals() {
    const container = $("goalList");

    if (!goals.length) {
        container.innerHTML = `<div class="card" style="grid-column:1/-1">${emptyState("target", "Sin metas todavía", "Define algo que quieras lograr y cuánto necesitas.", "")}</div>`;
        return;
    }

    container.innerHTML = goals.map(goal => {
        const percentage = Math.min((goal.saved / goal.target) * 100, 100);
        const done = percentage >= 100;
        const remaining = Math.max(goal.target - goal.saved, 0);

        return `
            <div class="card goal-list-card">
                <div class="goal-list-head">
                    <div class="goal-icon">${icon(goal.icon)}</div>
                    <div>
                        <strong>${escapeHTML(goal.name)}</strong>
                        <small>${formatMoney(goal.saved)} de ${formatMoney(goal.target)}</small>
                    </div>
                    <span class="goal-pct ${done ? "done" : ""}">${Math.round(percentage)}%</span>
                </div>
                <div>
                    <div class="progress-track"><div class="progress-fill ${done ? "done" : ""}" style="width:${percentage}%"></div></div>
                    <div class="goal-numbers">
                        <span>${done ? "¡Meta cumplida!" : "Te faltan " + formatMoney(remaining)}</span>
                    </div>
                </div>
                <div class="goal-actions">
                    <button class="secondary-btn" type="button" onclick="addToGoal('${goal.id}')">${icon("plus")}Agregar ahorro</button>
                    <button class="row-btn" type="button" onclick="editGoal('${goal.id}')" aria-label="Editar meta" title="Editar">${icon("edit")}</button>
                    <button class="row-btn del" type="button" onclick="deleteGoal('${goal.id}')" aria-label="Eliminar meta" title="Eliminar">${icon("trash")}</button>
                </div>
            </div>`;
    }).join("");
}

function goalFormHTML(goal = {}) {
    const selectedIcon = goal.icon || "star";
    return `
        <div class="field">
            <label for="gName">Nombre de la meta</label>
            <input type="text" id="gName" maxlength="40" placeholder="Ej. Fondo de emergencia" value="${escapeHTML(goal.name || "")}">
            <p class="field-error" id="gNameError"></p>
        </div>
        <div class="field">
            <label for="gTarget">¿Cuánto necesitas?</label>
            <div class="input-wrap money-input"><span class="input-prefix">$</span>
            <input type="number" id="gTarget" min="1" inputmode="decimal" placeholder="10000" value="${goal.target || ""}"></div>
            <p class="field-error" id="gTargetError"></p>
        </div>
        <div class="field">
            <span class="label">Ícono</span>
            <div class="icon-picker">
                ${GOAL_ICONS.map(name => `<label><input type="radio" name="gIcon" value="${name}" ${name === selectedIcon ? "checked" : ""}><span>${icon(name)}</span></label>`).join("")}
            </div>
        </div>`;
}

function readGoalForm() {
    const name = $("gName").value.trim();
    const target = Number($("gTarget").value);
    let ok = true;
    setFieldError("gName", ""); setFieldError("gTarget", "");
    if (!name) { setFieldError("gName", "Ponle un nombre a tu meta."); ok = false; }
    if (!Number.isFinite(target) || target <= 0) { setFieldError("gTarget", "Escribe una cantidad mayor a cero."); ok = false; }
    if (!ok) return null;
    return { name, target, icon: document.querySelector("[name=gIcon]:checked").value };
}

$("addGoal").addEventListener("click", () => {
    openModal({
        title: "Nueva meta",
        body: goalFormHTML(),
        confirmText: "Crear meta",
        onConfirm: () => {
            const data = readGoalForm();
            if (!data) return false;
            return runModalAction(async () => {
                const result = await apiRequest("/goals", {
                    method: "POST",
                    body: JSON.stringify({ ...data, saved: 0 })
                });
                goals.unshift({ id: String(result.id), saved: 0, ...data });
                renderGoals();
                renderHome();
                toast("Meta creada");
            });
        }
    });
});

function editGoal(id) {
    const goal = goals.find(item => item.id === id);
    if (!goal) return;
    openModal({
        title: "Editar meta",
        body: goalFormHTML(goal),
        confirmText: "Guardar cambios",
        onConfirm: () => {
            const data = readGoalForm();
            if (!data) return false;
            return runModalAction(async () => {
                await apiRequest(`/goals/${goal.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ ...data, saved: goal.saved })
                });
                Object.assign(goal, data);
                renderGoals();
                renderHome();
                toast("Meta actualizada");
            });
        }
    });
}

function addToGoal(id) {
    const goal = goals.find(item => item.id === id);
    if (!goal) return;
    const remaining = Math.max(goal.target - goal.saved, 0);

    openModal({
        title: `Agregar a "${goal.name}"`,
        body: `
            <div class="field">
                <label for="gAmount">¿Cuánto quieres agregar?</label>
                <div class="input-wrap money-input"><span class="input-prefix">$</span>
                <input type="number" id="gAmount" min="1" inputmode="decimal" placeholder="500"></div>
                <p class="field-error" id="gAmountError"></p>
            </div>
            <p class="small-muted">Llevas ${formatMoney(goal.saved)}. ${remaining ? "Te faltan " + formatMoney(remaining) + "." : "Ya cumpliste esta meta."}</p>`,
        confirmText: "Agregar",
        onConfirm: () => {
            const amount = Number($("gAmount").value);
            if (!Number.isFinite(amount) || amount <= 0) {
                setFieldError("gAmount", "Escribe una cantidad mayor a cero.");
                return false;
            }
            return runModalAction(async () => {
                const before = goal.saved / goal.target;
                const saved = goal.saved + amount;
                await apiRequest(`/goals/${goal.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ name: goal.name, target: goal.target, icon: goal.icon, saved })
                });
                goal.saved = saved;
                renderGoals();
                renderHome();
                checkGoalMilestone(goal, before);
                toast(`Agregaste ${formatMoney(amount)} a tu meta`);
            });
        }
    });
}

async function deleteGoal(id) {
    const goal = goals.find(item => item.id === id);
    if (!goal) return;
    const ok = await confirmDialog({ title: "¿Eliminar meta?", message: `Se eliminará "${goal.name}" y su progreso.` });
    if (!ok) return;
    try {
        await apiRequest(`/goals/${id}`, { method: "DELETE" });
    } catch (error) {
        toast(error.message, "error");
        return;
    }
    goals = goals.filter(item => item.id !== id);
    renderGoals();
    renderHome();
    toast("Meta eliminada");
}

/* ==========================================
   NOTIFICACIONES
========================================== */

const NOTIF_ICONS = { success: "check", warning: "alert", info: "bell", tip: "bulb", goal: "star" };

/* force = true la agrega aunque los avisos estén desactivados (ej. bienvenida) */
function addNotification(data, force = false) {
    if (!currentUser) return;
    if (currentUser.notificationsOn === false && !force) return;
    if (data.key && notifications.some(n => n.key === data.key)) return; // evitar repetidos

    notifications.unshift({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        time: Date.now(),
        read: false,
        ...data
    });
    notifications = notifications.slice(0, 40);
    saveNotifications();
    renderNotifications();

    const bell = $("notifBtn");
    bell.classList.remove("ring");
    void bell.offsetWidth;
    bell.classList.add("ring");
}

/* Revisa los datos y genera avisos útiles (sin repetirlos) */
function runSmartChecks() {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${now.getMonth() + 1}`;
    const month = getMonthMovements(now);
    const { income, expenses } = getTotals(month);

    if (!month.length && movements.length) {
        addNotification({
            key: "no-moves-" + monthKey, type: "info", icon: "clock",
            title: `Aún no registras nada en ${now.toLocaleDateString("es-MX", { month: "long" })}`,
            body: "Registrar tus gastos al día te ayuda a no perder de vista tu presupuesto.",
            action: { label: "Registrar ahora", section: "movementsSection" }
        });
    }

    if (income > 0 && expenses > income * .7) {
        addNotification({
            key: "spend70-" + monthKey, type: "warning",
            title: "Tus gastos ya superan el 70% de tus ingresos",
            body: `Este mes llevas ${formatMoney(expenses)} gastados de ${formatMoney(income)}. Revisa tus gastos variables.`,
            action: { label: "Ver movimientos", section: "movementsSection" }
        });
    }

    if (income > 0 && expenses > income) {
        addNotification({
            key: "over-" + monthKey, type: "warning",
            title: "Este mes gastaste más de lo que ingresó",
            body: `Tu balance mensual es de ${formatMoney(income - expenses)}.`,
            action: { label: "Ver resumen", section: "movementsSection" }
        });
    }

    goals.forEach(goal => checkGoalMilestone(goal, 0, true));

    // Un consejo cada 3 días
    const lastTip = notifications.find(n => n.type === "tip");
    if (!lastTip || Date.now() - lastTip.time > 3 * 86400000) {
        const topic = TOPICS[Math.floor(Math.random() * TOPICS.length)];
        addNotification({
            key: "tip-" + toISODate(now), type: "tip",
            title: "Consejo: " + topic.title.replace(/[¿?]/g, ""),
            body: topic.tip,
            action: { label: "Leer tema", topic: topic.id }
        });
    }
}

function checkGoalMilestone(goal, beforeRatio, silent = false) {
    const ratio = goal.saved / goal.target;
    if (ratio >= 1 && (silent || beforeRatio < 1)) {
        addNotification({
            key: `goal100-${goal.id}`, type: "goal",
            title: `¡Cumpliste tu meta "${goal.name}"!`,
            body: `Juntaste ${formatMoney(goal.saved)}. Es buen momento para definir tu siguiente objetivo.`,
            action: { label: "Ver metas", section: "goalsSection" }
        });
    } else if (ratio >= .5 && (silent || beforeRatio < .5)) {
        addNotification({
            key: `goal50-${goal.id}`, type: "success",
            title: `Vas a la mitad de "${goal.name}"`,
            body: `Llevas ${formatMoney(goal.saved)} de ${formatMoney(goal.target)}. ¡Sigue así!`,
            action: { label: "Ver metas", section: "goalsSection" }
        });
    }
}

function renderNotifications() {
    const unread = notifications.filter(n => !n.read).length;
    const badge = $("notifBadge");
    badge.textContent = unread > 9 ? "9+" : unread;
    badge.classList.toggle("hidden", unread === 0);
    $("notifBtn").setAttribute("aria-label", unread ? `Notificaciones, ${unread} sin leer` : "Notificaciones");
    $("notifSummary").textContent = unread ? `${unread} sin leer` : "Estás al día";
    $("markAllRead").classList.toggle("hidden", unread === 0);
    $("clearNotifs").parentElement.classList.toggle("hidden", !notifications.some(n => n.read));

    const list = notifFilter === "unread" ? notifications.filter(n => !n.read) : notifications;

    if (!list.length) {
        $("notifList").innerHTML = `
            <div class="notif-empty">
                <div class="empty-icon">${icon("check")}</div>
                <strong>${notifFilter === "unread" ? "No tienes avisos pendientes" : "Estás al día"}</strong>
                <p>Te avisaremos cuando una meta avance o tus gastos suban.</p>
            </div>`;
        return;
    }

    // Agrupar por "Hoy" y "Anteriores"
    const startOfDay = new Date().setHours(0, 0, 0, 0);
    const today = list.filter(n => n.time >= startOfDay);
    const older = list.filter(n => n.time < startOfDay);

    const item = n => `
        <button type="button" class="notif-item ${n.read ? "" : "unread"}" data-nid="${n.id}">
            <span class="notif-icon ${n.type}">${icon(n.icon || NOTIF_ICONS[n.type] || "bell")}</span>
            <span class="notif-text">
                <strong>${escapeHTML(n.title)}</strong>
                <p>${escapeHTML(n.body)}</p>
                ${n.action ? `<span class="notif-cta">${escapeHTML(n.action.label)}</span>` : ""}
                <time>${timeAgo(n.time)}</time>
            </span>
            ${n.read ? "" : `<span class="unread-dot" aria-label="Sin leer"></span>`}
        </button>`;

    $("notifList").innerHTML =
        (today.length ? `<div class="notif-group">Hoy</div>${today.map(item).join("")}` : "") +
        (older.length ? `<div class="notif-group">Anteriores</div>${older.map(item).join("")}` : "");
}

function openNotifications() {
    $("moreSheet").classList.remove("open");
    renderNotifications();
    $("notifPanel").classList.add("open");
    $("notifPanel").setAttribute("aria-hidden", "false");
    $("notifBtn").setAttribute("aria-expanded", "true");
    $("scrim").className = "scrim show";
}

function closeNotifications() {
    $("notifPanel").classList.remove("open");
    $("notifPanel").setAttribute("aria-hidden", "true");
    $("notifBtn").setAttribute("aria-expanded", "false");
    $("scrim").className = "scrim";
}

$("notifBtn").addEventListener("click", () => {
    $("notifPanel").classList.contains("open") ? closeNotifications() : openNotifications();
});
$("notifClose").addEventListener("click", closeNotifications);
$("openNotifsFromProfile").addEventListener("click", openNotifications);

$("notifList").addEventListener("click", event => {
    const button = event.target.closest("[data-nid]");
    if (!button) return;
    const n = notifications.find(item => item.id === button.dataset.nid);
    if (!n) return;

    n.read = true;
    saveNotifications();
    renderNotifications();

    if (n.action?.section) showSection(n.action.section);
    if (n.action?.topic) { closeNotifications(); openTopic(n.action.topic); }
});

$("markAllRead").addEventListener("click", () => {
    notifications.forEach(n => n.read = true);
    saveNotifications();
    renderNotifications();
});

$("clearNotifs").addEventListener("click", () => {
    notifications = notifications.filter(n => !n.read);
    saveNotifications();
    renderNotifications();
});

document.querySelectorAll("#notifTabs button").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll("#notifTabs button").forEach(b => b.classList.remove("active"));
        button.classList.add("active");
        notifFilter = button.dataset.nfilter;
        renderNotifications();
    });
});

$("notifToggle").addEventListener("change", async function () {
    const enabled = this.checked;
    try {
        await saveProfile({ notificaciones_activadas: enabled ? 1 : 0 });
        currentUser.notificationsOn = enabled;
        toast(enabled ? "Avisos activados" : "Avisos desactivados", "info");
        if (enabled) runSmartChecks();
    } catch (error) {
        this.checked = !enabled;
        toast(error.message, "error");
    }
});

/* ==========================================
   EDUCACIÓN FINANCIERA
========================================== */

let topicCategory = "all";

function renderTopics() {
    $("topicList").innerHTML = TOPICS.map(topic => `
        <button type="button" class="topic-card" data-category="${topic.category}" data-topic-id="${topic.id}">
            <span class="topic-icon">${icon(topic.icon)}</span>
            <span class="topic-info">
                <strong>${topic.title}</strong>
                <small><span class="level ${topic.level === "Intermedio" ? "mid" : ""}">${topic.level}</span>${topic.minutes} min de lectura</small>
            </span>
            ${icon("right", "icon topic-arrow")}
        </button>`).join("");
}

function filterTopics() {
    const query = $("topicSearch").value.toLowerCase().trim();
    let visible = 0;
    document.querySelectorAll(".topic-card").forEach(card => {
        const show = (topicCategory === "all" || card.dataset.category === topicCategory)
            && card.textContent.toLowerCase().includes(query);
        card.style.display = show ? "" : "none";
        if (show) visible++;
    });
    $("topicEmpty").classList.toggle("hidden", visible > 0);
}

function openTopic(id) {
    const topic = TOPICS.find(t => t.id === id);
    if (!topic) return;
    openModal({
        title: topic.title,
        body: `
            <div class="topic-reader">
                <p class="reader-meta"><span class="level ${topic.level === "Intermedio" ? "mid" : ""}">${topic.level}</span>${topic.minutes} min de lectura</p>
                <p>${topic.body}</p>
                <div class="recommendation reader-tip">
                    <div class="recommendation-icon">${icon("bulb")}</div>
                    <div><strong>Para ponerlo en práctica</strong><p>${topic.tip}</p></div>
                </div>
            </div>`,
        confirmText: "Listo",
        hideCancel: true
    });
}

$("topicList").addEventListener("click", event => {
    const card = event.target.closest("[data-topic-id]");
    if (card) openTopic(card.dataset.topicId);
});

$("topicSearch").addEventListener("input", filterTopics);

document.querySelectorAll("[data-topic]").forEach(button => {
    button.addEventListener("click", () => {
        document.querySelectorAll("[data-topic]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        topicCategory = button.dataset.topic;
        filterTopics();
    });
});

/* ==========================================
   SIMULADORES
========================================== */

function selectSimulator(type) {
    simulatorType = type;
    const config = {
        saving: { title: "Simulador de ahorro", label: "¿Cuánto ahorrarás cada mes?", rate: false },
        investment: { title: "Simulador de inversión", label: "¿Cuánto invertirás cada mes?", rate: true },
        credit: { title: "Simulador de crédito", label: "¿Cuánto te prestarán?", rate: true },
        retirement: { title: "Simulador de retiro", label: "¿Cuánto aportarás cada mes?", rate: true }
    }[type];

    $("simulatorTitle").textContent = config.title;
    $("simAmountLabel").textContent = config.label;
    $("simRateField").classList.toggle("hidden", !config.rate);
    $("simulatorResult").classList.add("hidden");
    $("simError").textContent = "";

    document.querySelectorAll(".sim-option").forEach(option => {
        const active = option.dataset.sim === type;
        option.classList.toggle("active", active);
        option.setAttribute("aria-selected", active);
    });
}

document.querySelectorAll(".sim-option").forEach(option => {
    option.addEventListener("click", () => {
        selectSimulator(option.dataset.sim);
        $("simulatorTitle").scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

$("simulatorForm").addEventListener("submit", event => {
    event.preventDefault();
    const amount = Number($("simAmount").value);
    const months = Number($("simMonths").value);
    const rate = simulatorType === "saving" ? 0 : Number($("simRate").value) || 0;

    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(months) || months <= 0) {
        $("simError").textContent = "Escribe una cantidad mayor a cero y un plazo en meses completos.";
        return;
    }
    $("simError").textContent = "";

    const monthlyRate = rate / 100 / 12;
    let result, label, description, breakdown;

    if (simulatorType === "credit") {
        result = monthlyRate === 0 ? amount / months : amount * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
        const totalPaid = result * months;
        label = "Pago mensual aproximado";
        description = "Sin incluir comisiones, seguros u otros cargos.";
        breakdown = [["Total a pagar", totalPaid], ["Intereses", totalPaid - amount]];
    } else {
        result = monthlyRate === 0 ? amount * months : amount * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
        const contributed = amount * months;
        label = "Tendrías aproximadamente";
        description = rate > 0
            ? "Proyección estimada. Los rendimientos reales pueden variar."
            : `Ahorrando ${formatMoney(amount)} cada mes durante ${months} meses.`;
        breakdown = [["Lo que aportas", contributed], ["Rendimiento", result - contributed]];
    }

    $("simResultLabel").textContent = label;
    $("simResultAmount").textContent = formatMoney(result);
    const showBreakdown = simulatorType === "credit" || rate > 0;
    $("simResultDescription").innerHTML = escapeHTML(description) + (!showBreakdown ? "" :
        `<div class="sim-breakdown">${breakdown.map(([k, v]) => `<div><small>${k}</small><b>${formatMoney(v)}</b></div>`).join("")}</div>`);
    $("simulatorResult").classList.remove("hidden");
});

/* ==========================================
   ASISTENTE DEMOSTRATIVO
========================================== */

function botReply(message) {
    const lower = message.toLowerCase();
    const totals = getTotals();

    if (lower.includes("gasto") || lower.includes("gastado"))
        return "Tus gastos registrados suman " + formatMoney(totals.expenses) + ". Puedes revisar el detalle en la sección Movimientos.";
    if (lower.includes("ahorr"))
        return "Actualmente tienes registrados " + formatMoney(totals.savings) + " en la categoría de ahorro. Establece una cantidad que puedas guardar de manera constante.";
    if (lower.includes("ingreso"))
        return "Tus ingresos registrados suman " + formatMoney(totals.income) + ". Recuerda registrar todos tus ingresos para tener un balance más completo.";
    if (lower.includes("balance") || lower.includes("dinero"))
        return "Tu balance actual es de " + formatMoney(totals.balance) + ". Revisa tus movimientos para conocer cómo se distribuye tu dinero.";
    if (lower.includes("presupuesto"))
        return "Para crear un presupuesto, identifica tus ingresos, separa tus gastos necesarios y establece un límite para los gastos personales. Una guía común es 50% necesidades, 30% gustos y 20% ahorro.";
    if (lower.includes("meta"))
        return goals.length ? `Tienes ${goals.length} meta(s). La principal es "${goals[0].name}" con ${formatMoney(goals[0].saved)} de ${formatMoney(goals[0].target)}.` : "Aún no tienes metas. Puedes crear una en la sección Metas.";
    return "Una buena práctica es registrar tus ingresos y gastos, establecer prioridades y revisar tu presupuesto cada semana.";
}

function addBubble(text, who) {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble " + who;
    bubble.textContent = text;
    $("chatMessages").appendChild(bubble);
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
    return bubble;
}

async function sendChat(message) {
    message = message.trim();
    if (!message) return;
    addBubble(message, "user");
    $("chatMessage").value = "";

    const typing = document.createElement("div");
    typing.className = "chat-bubble bot typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    $("chatMessages").appendChild(typing);
    $("chatMessages").scrollTop = $("chatMessages").scrollHeight;

    await wait(650);
    typing.remove();
    addBubble(botReply(message), "bot");
}

$("chatForm").addEventListener("submit", event => {
    event.preventDefault();
    sendChat($("chatMessage").value);
});

$("chatSuggestions").addEventListener("click", event => {
    if (event.target.tagName === "BUTTON") sendChat(event.target.textContent);
});

/* ==========================================
   MENTOR IA (salud financiera con IA)
   La pregunta se envía al backend, que agrega los datos del usuario
   desde MySQL y consulta al proveedor de IA. La clave nunca llega
   al navegador.
========================================== */

let aiHistory = [];
let aiBusy = false;
let aiStatusChecked = false;

/* Formato seguro: escapa el HTML y permite **negritas** y viñetas "- " */
function formatAIText(text) {
    const inline = line => escapeHTML(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const blocks = [];
    let list = null;

    text.split("\n").forEach(raw => {
        const line = raw.trim();
        const bullet = line.match(/^(?:[-*•])\s+(.*)$/);

        if (bullet) {
            if (!list) { list = []; blocks.push({ list }); }
            list.push(inline(bullet[1]));
            return;
        }
        list = null;
        if (line) blocks.push({ text: inline(line.replace(/^#+\s*/, "")) });
    });

    return blocks.map(b => b.list
        ? `<ul>${b.list.map(item => `<li>${item}</li>`).join("")}</ul>`
        : `<p>${b.text}</p>`).join("");
}

function addAIBubble(content, who, { html = false, extraClass = "" } = {}) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${who} ${extraClass}`.trim();
    if (html) bubble.innerHTML = content;
    else bubble.textContent = content;
    $("aiMessages").appendChild(bubble);
    $("aiMessages").scrollTop = $("aiMessages").scrollHeight;
    return bubble;
}

function resetAIChat() {
    aiHistory = [];
    aiBusy = false;
    aiStatusChecked = false;
    $("aiMessages").innerHTML = "";
    $("aiMessage").value = "";
}

function aiWelcome() {
    const firstName = currentUser ? currentUser.name.split(" ")[0] : "";
    addAIBubble(
        `<p>¡Hola${firstName ? ", " + escapeHTML(firstName) : ""}! Soy <strong>Mentor IA</strong>.</p>
         <p>Puedo ayudarte con presupuesto, ahorro, gastos, deudas, metas y conceptos básicos de inversión. Uso tus movimientos y metas registrados para darte respuestas personalizadas.</p>`,
        "bot", { html: true }
    );
}

async function prepareAISection() {
    if (!$("aiMessages").children.length) aiWelcome();
    if (aiStatusChecked) return;
    aiStatusChecked = true;

    try {
        const status = await apiRequest("/ai/status");
        if (!status.disponible) {
            addAIBubble("Mentor IA aún no está configurado en el servidor. Agrega una clave de IA en el archivo .env del backend y reinicia el servidor.", "bot", { extraClass: "ai-error" });
        }
    } catch {
        aiStatusChecked = false;
    }
}

async function sendAI(message) {
    message = message.trim();
    if (!message || aiBusy) return;
    if (message.length > 600) {
        toast("Tu pregunta es muy larga. Resúmela en menos de 600 caracteres.", "warning");
        return;
    }

    aiBusy = true;
    $("aiSend").disabled = true;
    addAIBubble(message, "user");
    $("aiMessage").value = "";

    const typing = document.createElement("div");
    typing.className = "chat-bubble bot typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    $("aiMessages").appendChild(typing);
    $("aiMessages").scrollTop = $("aiMessages").scrollHeight;

    try {
        const data = await apiRequest("/ai/chat", {
            method: "POST",
            body: JSON.stringify({ mensaje: message, historial: aiHistory.slice(-10) })
        });
        typing.remove();
        addAIBubble(formatAIText(data.respuesta), "bot", { html: true, extraClass: "ai-answer" });

        aiHistory.push({ rol: "usuario", texto: message }, { rol: "asistente", texto: data.respuesta });
        aiHistory = aiHistory.slice(-10);
    } catch (error) {
        typing.remove();
        if (currentUser) addAIBubble(error.message, "bot", { extraClass: "ai-error" });
    } finally {
        aiBusy = false;
        $("aiSend").disabled = false;
        if (currentUser) $("aiMessage").focus();
    }
}

$("aiForm").addEventListener("submit", event => {
    event.preventDefault();
    sendAI($("aiMessage").value);
});

$("aiSuggestions").addEventListener("click", event => {
    if (event.target.tagName === "BUTTON") sendAI(event.target.textContent);
});

$("aiClear").addEventListener("click", () => {
    if (aiBusy) return;
    aiHistory = [];
    $("aiMessages").innerHTML = "";
    aiWelcome();
    $("aiMessage").focus();
});

/* ==========================================
   PERFIL
========================================== */

$("editProfileBtn").addEventListener("click", () => {
    const objectives = ["Ahorrar", "Controlar mis gastos", "Invertir", "Pagar deudas"];
    openModal({
        title: "Editar perfil",
        body: `
            <div class="field">
                <label for="pName">Nombre completo</label>
                <input type="text" id="pName" value="${escapeHTML(currentUser.name)}">
                <p class="field-error" id="pNameError"></p>
            </div>
            <div class="field">
                <label for="pObjective">Objetivo principal</label>
                <select id="pObjective">${objectives.map(o => `<option ${o === currentUser.objective ? "selected" : ""}>${o}</option>`).join("")}</select>
            </div>
            <div class="form-row">
                <div class="field">
                    <label for="pIncome">Ingreso mensual</label>
                    <div class="input-wrap money-input"><span class="input-prefix">$</span>
                    <input type="number" id="pIncome" min="0" value="${currentUser.monthlyIncome || 0}"></div>
                </div>
                <div class="field">
                    <label for="pDebts">¿Tienes deudas?</label>
                    <select id="pDebts"><option ${currentUser.debts === "No" ? "selected" : ""}>No</option><option ${currentUser.debts === "Sí" ? "selected" : ""}>Sí</option></select>
                </div>
            </div>`,
        confirmText: "Guardar cambios",
        onConfirm: () => {
            const name = $("pName").value.trim();
            if (name.length < 2) { setFieldError("pName", "Escribe tu nombre."); return false; }
            const changes = {
                name,
                objective: $("pObjective").value,
                monthlyIncome: Number($("pIncome").value) || 0,
                debts: $("pDebts").value
            };
            return runModalAction(async () => {
                await saveProfile({
                    nombre: changes.name,
                    objetivo: changes.objective,
                    ingreso_mensual: changes.monthlyIncome,
                    deudas: changes.debts === "Sí" ? 1 : 0
                });
                Object.assign(currentUser, changes);
                fillUserInfo();
                toast("Perfil actualizado");
            });
        }
    });
});

$("changePassBtn").addEventListener("click", () => {
    openModal({
        title: "Cambiar contraseña",
        body: `
            <div class="field">
                <label for="cpCurrent">Contraseña actual</label>
                <input type="password" id="cpCurrent" autocomplete="current-password">
                <p class="field-error" id="cpCurrentError"></p>
            </div>
            <div class="field">
                <label for="cpNew">Nueva contraseña</label>
                <input type="password" id="cpNew" autocomplete="new-password" placeholder="Mínimo ${MIN_PASSWORD} caracteres">
                <p class="field-error" id="cpNewError"></p>
            </div>`,
        confirmText: "Actualizar",
        onConfirm: () => {
            const current = $("cpCurrent").value;
            const next = $("cpNew").value;
            setFieldError("cpCurrent", ""); setFieldError("cpNew", "");
            if (!current) { setFieldError("cpCurrent", "Escribe tu contraseña actual."); return false; }
            if (next.length < MIN_PASSWORD) { setFieldError("cpNew", `Necesita al menos ${MIN_PASSWORD} caracteres.`); return false; }

            return runModalAction(async () => {
                try {
                    await apiRequest("/auth/password", {
                        method: "PUT",
                        body: JSON.stringify({ actual: current, nueva: next })
                    });
                } catch (error) {
                    if (error.status === 400) {
                        setFieldError("cpCurrent", error.message);
                        return false;
                    }
                    throw error;
                }
                addNotification({ type: "success", icon: "shield", title: "Actualizaste tu contraseña", body: "Si no fuiste tú, cámbiala de nuevo desde tu perfil." }, true);
                toast("Contraseña actualizada");
            });
        }
    });
});

$("helpBtn").addEventListener("click", () => {
    openModal({
        title: "Ayuda y soporte",
        body: `<p>MoneyMentor es un prototipo académico. Tus movimientos, metas y perfil se guardan en tu cuenta, así que puedes consultarlos desde cualquier navegador al iniciar sesión.</p>
               <p style="margin-top:10px">Para empezar: registra tus ingresos y gastos en <b>Movimientos</b>, crea objetivos en <b>Metas</b> y revisa tus avisos en la campana.</p>`,
        confirmText: "Entendido",
        hideCancel: true
    });
});

/* ==========================================
   RECORRIDO GUIADO (TOUR)
========================================== */

const TOUR_STEPS = [
    {
        selector: ".hero-card",
        section: "homeSection",
        title: "Tu balance y salud financiera",
        body: "Aquí verás cuánto dinero tienes disponible y tu puntaje de salud financiera de un vistazo."
    },
    {
        selector: ".quick-actions",
        section: "homeSection",
        title: "Acciones rápidas",
        body: "Registra un gasto o ingreso al instante, abre un simulador o consulta al asistente con un toque."
    },
    {
        selector: ".health-card",
        section: "homeSection",
        title: "Gráfica de tus finanzas",
        body: "Compara tus ingresos, gastos y ahorros para entender rápidamente cómo se mueve tu dinero."
    },
    {
        selector: ".main-goal-card",
        section: "homeSection",
        title: "Metas y recomendaciones",
        body: "Revisa el avance de tu meta principal y recibe consejos personalizados todos los días."
    },
    {
        selector: "#notifBtn",
        section: "homeSection",
        title: "Centro de notificaciones",
        body: "Toca la campana para ver alertas cuando tus gastos suban o cuando avances en tus metas."
    },
    {
        selector: ".bottom-nav",
        section: "homeSection",
        title: "Navegación principal",
        body: "Muévete entre Inicio, Movimientos, Metas, Aprender y el menú Más (Simuladores, Asistente, Mentor IA y Perfil)."
    }
];

let tourIndex = 0;

function startTour() {
    closeOverlays();
    tourIndex = 0;
    $("tourOverlay").classList.remove("hidden");
    renderTourStep();
}

function endTour() {
    $("tourOverlay").classList.add("hidden");
    if (currentUser && !currentUser.tourCompleted) {
        currentUser.tourCompleted = true;
        saveProfile({ tour_completado: 1 }).catch(() => {});
    }
}

function positionTourElements() {
    if ($("tourOverlay").classList.contains("hidden")) return;
    const step = TOUR_STEPS[tourIndex];
    const target = document.querySelector(step.selector);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const pad = 6;
    const spot = $("tourSpotlight");

    spot.style.top = `${Math.max(4, rect.top - pad)}px`;
    spot.style.left = `${Math.max(4, rect.left - pad)}px`;
    spot.style.width = `${rect.width + pad * 2}px`;
    spot.style.height = `${rect.height + pad * 2}px`;

    const card = $("tourCard");
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom;
    const spaceAbove = rect.top;

    card.style.top = "";
    card.style.bottom = "";

    if (spaceBelow >= 230 || spaceBelow >= spaceAbove) {
        const topPos = Math.min(vh - card.offsetHeight - 16, rect.bottom + pad + 14);
        card.style.top = `${Math.max(16, topPos)}px`;
    } else {
        const bottomPos = Math.min(vh - 16, vh - rect.top + pad + 14);
        card.style.bottom = `${Math.max(16, bottomPos)}px`;
    }
}

function renderTourStep() {
    const step = TOUR_STEPS[tourIndex];
    if (step.section && currentSection !== step.section) {
        showSection(step.section);
    }

    $("tourStep").textContent = `Paso ${tourIndex + 1} de ${TOUR_STEPS.length}`;
    $("tourTitle").textContent = step.title;
    $("tourBody").textContent = step.body;

    $("tourDots").innerHTML = TOUR_STEPS.map((_, i) =>
        `<i class="${i === tourIndex ? "active" : ""}"></i>`
    ).join("");

    $("tourPrev").classList.toggle("hidden", tourIndex === 0);
    $("tourNext").textContent = tourIndex === TOUR_STEPS.length - 1 ? "¡Empezar!" : "Siguiente";

    const target = document.querySelector(step.selector);
    if (target) {
        const isFixed = step.selector === ".bottom-nav" || step.selector === "#notifBtn";
        if (!isFixed) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        setTimeout(positionTourElements, isFixed ? 50 : 280);
    }
}

$("tourNext").addEventListener("click", () => {
    if (tourIndex < TOUR_STEPS.length - 1) {
        tourIndex++;
        renderTourStep();
    } else {
        endTour();
        toast("¡Listo! Ya conoces MoneyMentor.");
    }
});

$("tourPrev").addEventListener("click", () => {
    if (tourIndex > 0) {
        tourIndex--;
        renderTourStep();
    }
});

$("tourSkip").addEventListener("click", endTour);
$("restartTourBtn").addEventListener("click", startTour);
window.addEventListener("resize", positionTourElements);
window.addEventListener("scroll", positionTourElements, { passive: true });

/* ==========================================
   ACTUALIZAR TODAS LAS VISTAS
========================================== */

function renderAll() {
    renderHome();
    renderMovements();
    renderGoals();
}

/* ==========================================
   ARRANQUE
========================================== */

selectSimulator("saving");
cleanupLegacyStorage();
restoreSession().then(restored => {
    if (!restored && !currentUser) showScreen("loginScreen");
});