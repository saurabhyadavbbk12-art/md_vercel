// ============================================
// MD ENTERPRISE - GLOBAL AUTH MANAGER
// auth-global.js — FINAL VERSION
// ============================================

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
    getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    getFirestore, doc, getDoc, collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBEXf9jWwqiQTfVSzD3MwuXafi4tm6ON48",
    authDomain: "barabanks-hardware.firebaseapp.com",
    projectId: "barabanks-hardware",
    storageBucket: "barabanks-hardware.firebasestorage.app",
    messagingSenderId: "85482630977",
    appId: "1:85482630977:web:acbc3d101f9d8401f17bc0",
    measurementId: "G-WVCMST1NTK"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ============================================
// GLOBAL USER STATE
// ============================================
const MDUser = {
    uid: null, email: null, displayName: null, profile: null, membership: null,
    orderCount: 0, consultationCount: 0, isAdmin: false,
    _readyPromise: null, _resolveReady: null,

    ready() {
        if (!this._readyPromise) {
            this._readyPromise = new Promise((resolve) => { this._resolveReady = resolve; });
        }
        return this._readyPromise;
    },

    async refresh() {
        if (!auth.currentUser) { this._applyUserData(null); return null; }
        await this._loadUserData(auth.currentUser);
        this._updateHeaderUI();
        this._dispatchReadyEvent();
        return this;
    },

    get() {
        if (!this.uid) return null;
        return {
            uid: this.uid, email: this.email, displayName: this.displayName,
            profile: this.profile, membership: this.membership,
            orderCount: this.orderCount, consultationCount: this.consultationCount, isAdmin: this.isAdmin
        };
    },

    isLoggedIn() { return !!this.uid; },

    async _loadUserData(user) {
        this.uid = user.uid;
        this.email = user.email;
        this.displayName = user.displayName || (user.email ? user.email.split('@')[0] : 'User');

        try {
            const [ userDoc, subSnap, orderSnap, consSnap, adminDoc ] = await Promise.all([
                getDoc(doc(db, "users", user.uid)),
                getDocs(query(collection(db, "subscriptions"), where("userId", "==", user.uid))).catch(() => ({ forEach: () => {}, size: 0 })),
                getDocs(query(collection(db, "orders"), where("userId", "==", user.uid))).catch(() => ({ size: 0 })),
                getDocs(query(collection(db, "consultations"), where("userId", "==", user.uid))).catch(() => ({ size: 0 })),
                getDoc(doc(db, "admins", user.uid)).catch(() => ({ exists: () => false }))
            ]);

            this.profile = userDoc.exists() ? userDoc.data() : {};
            let latestPlan = null; let latestExpiry = 0;
            subSnap.forEach(docSnap => {
                const plan = docSnap.data();
                const expiry = new Date(plan.expiryDate || 0).getTime();
                if (expiry > latestExpiry) { latestExpiry = expiry; latestPlan = plan; }
            });
            this.membership = latestPlan;
            this.orderCount = orderSnap.size;
            this.consultationCount = consSnap.size;
            this.isAdmin = adminDoc.exists();

            // ✅ दोनों cache में save करो
            sessionStorage.setItem('md_user_cache', JSON.stringify(this.get()));
            localStorage.setItem('md_user_cache_permanent', JSON.stringify(this.get()));

        } catch (err) {
            console.error("Error loading user data:", err);
        }
    },

    _applyUserData(user) {
        if (!user) {
            this.uid = null; this.email = null; this.displayName = null; this.profile = null;
            this.membership = null; this.orderCount = 0; this.consultationCount = 0; this.isAdmin = false;
            sessionStorage.removeItem('md_user_cache');
            localStorage.removeItem('md_user_cache_permanent');
        }
    },

    _updateHeaderUI() {
        const loginLink = document.getElementById('nav-login-link');
        if (!loginLink) return;
        if (this.uid) {
            const firstName = (this.profile?.fullName || this.displayName || 'User').split(' ')[0];
            loginLink.innerHTML = `👤 ${firstName}`;
            loginLink.title = `Logged in as ${this.email}`;
        } else {
            loginLink.innerHTML = `👤`;
            loginLink.title = 'Login / My Account';
        }
    },

    _dispatchReadyEvent() {
        window.dispatchEvent(new CustomEvent('md-user-ready', { detail: this.get() }));
    }
};

// ============================================
// CACHE से तुरंत डेटा उठाओ
// ============================================
let cachedUser = sessionStorage.getItem('md_user_cache');
if (!cachedUser) {
    cachedUser = localStorage.getItem('md_user_cache_permanent');
}
if (cachedUser) {
    try {
        const parsed = JSON.parse(cachedUser);
        Object.assign(MDUser, parsed);
        MDUser._updateHeaderUI();
        console.log("✅ User loaded from cache instantly");
    } catch(e){}
}

// ============================================
// AUTH OBSERVER
// ============================================
onAuthStateChanged(auth, async (user) => {
    if (user) { await MDUser._loadUserData(user); } 
    else { MDUser._applyUserData(null); }
    
    MDUser._updateHeaderUI();
    MDUser._dispatchReadyEvent();

    if (MDUser._resolveReady) {
        MDUser._resolveReady(MDUser.get());
        MDUser._resolveReady = null;
    }
});

// ============================================
// GLOBAL EXPORTS
// ============================================
window.MDUser = MDUser;
window.MDAuth = auth;
window.MDDB = db;
window.MDStorage = storage;
window.MD_READY = MDUser.ready();

// ✅ यह function हर page पर use होगा
window.MDWaitForUser = async function() {
    // अगर uid पहले से set है (cache से) तो तुरंत return
    if (MDUser.uid !== null && MDUser.uid !== undefined) {
        // अगर ready promise पहले से resolved है, तो 100ms में return
        try {
            return await Promise.race([
                MDUser.ready(),
                new Promise(resolve => setTimeout(() => resolve(MDUser.get()), 150))
            ]);
        } catch(e) {
            return MDUser.get();
        }
    }
    // वरना ready होने का इंतज़ार करो
    return await MDUser.ready();
};

window.dispatchEvent(new Event('md-global-ready')); 
console.log("✅ MD auth-global.js loaded (with MDWaitForUser)");