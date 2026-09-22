import { PROFILES, STORAGE_KEYS, getUserProfile, saveUserProfile, resetUserProfile, getAllUserKeys, createUserProfile, deleteUserProfile } from './config.js';
import { getStoredItem, setStoredItem } from './storage.js';
import { isSuperAdminEmail, normalizeEmail } from './firebase.js';

export const AVAILABLE_THEMES = [
  {
    id: 'light',
    name: 'בהיר נקי (Clean Light)',
    desc: 'רקע לבן נקי, כיתוב כהה חד וקריא עם הדגשות אמרלד',
    bgClass: 'bg-[#f8fafc]',
    cardClass: 'bg-white',
    accentColor: '#059669',
    badge: 'בהיר קלאסי',
    icon: 'sun'
  },
  {
    id: 'emerald',
    name: 'ירוק אמרלד על לבן (Emerald White)',
    desc: 'רקע לבן בוהק, כל הכיתוב בירוק כהה, ירוק רענן והדגשות ירוקות',
    bgClass: 'bg-[#f0fdf4]',
    cardClass: 'bg-white',
    accentColor: '#059669',
    badge: 'ירוק על לבן',
    icon: 'trees'
  },
  {
    id: 'midnight',
    name: 'כחול אוקיינוס על לבן (Ocean Blue)',
    desc: 'רקע לבן בוהק, כל הכיתוב בכחול נייבי עמוק, ספיר ותכלת',
    bgClass: 'bg-[#f0f9ff]',
    cardClass: 'bg-white',
    accentColor: '#0284c7',
    badge: 'כחול על לבן',
    icon: 'sparkles'
  },
  {
    id: 'cream',
    name: 'שנהב חם (Warm Daylight)',
    desc: 'רקע לבן-שמנת חמים, כל הכיתוב בענבר חם וחום עמוק',
    bgClass: 'bg-[#faf7f2]',
    cardClass: 'bg-white',
    accentColor: '#d97706',
    badge: 'חם על לבן',
    icon: 'sun-medium'
  },
  {
    id: 'slate',
    name: 'ערכה כהה (Dark Slate)',
    desc: 'רקע כהה סלייט מודרני עם כיתוב בהיר והדגשות זוהרות',
    bgClass: 'bg-[#020617]',
    cardClass: 'bg-[#1e293b]',
    accentColor: '#10b981',
    badge: 'ערכה כהה',
    icon: 'moon'
  },
  {
    id: 'oled',
    name: 'ערכה כהה - שחור עמוק (OLED Pure Black)',
    desc: 'שחור מוחלט 100%, חיסכון מקסימלי בסוללה במסכי OLED',
    bgClass: 'bg-black',
    cardClass: 'bg-[#121212]',
    accentColor: '#10b981',
    badge: 'שחור מוחלט',
    icon: 'battery-charging'
  }
];

export function isThemeLight(themeId) {
  // Only 'slate' and 'oled' are dark themes. ALL other themes are light with pure white/light backgrounds!
  const id = themeId || getStoredItem('ag_theme', 'light');
  return id !== 'slate' && id !== 'oled';
}

class AppState {
  constructor() {
    const userList = getAllUserKeys();
    this.activeUser = getStoredItem(STORAGE_KEYS.ACTIVE_USER, 'Arik');
    if (!userList.includes(this.activeUser)) {
      this.activeUser = 'Arik';
    }
    
    const todayStr = new Date().toISOString().split('T')[0];
    this.selectedDate = getStoredItem(STORAGE_KEYS.SELECTED_DATE, todayStr);
    this.activeTab = 'dashboard';
    this.isProfileModalOpen = false;
    this.isThemeModalOpen = false;
    this.theme = getStoredItem('ag_theme', 'light');
    this.applyThemeToDOM(this.theme);

    // Firebase Auth & Cloud Sync State
    const savedAuth = getStoredItem('ag_auth_user', null);
    if (savedAuth && savedAuth.email) {
      this.authUser = savedAuth;
      this.isSuperAdmin = isSuperAdminEmail(savedAuth.email);
    } else {
      this.authUser = null;
      this.isSuperAdmin = false;
    }
    this.authReady = true;
    this.whitelist = ['arik.pic@gmail.com', 'granit@gmail.com'];
    this.customMeals = [];
    this.isAuthChecking = false;

    this.listeners = [];
  }

  setAuthUser(user) {
    if (user) {
      const email = (user.email || user.providerData?.[0]?.email || '').trim().toLowerCase();
      this.isSuperAdmin = isSuperAdminEmail(email);
      const safeUser = {
        uid: user.uid || '',
        email: email,
        displayName: user.displayName || user.providerData?.[0]?.displayName || (email ? email.split('@')[0] : 'משתמש'),
        photoURL: user.photoURL || user.providerData?.[0]?.photoURL || '',
        isSuperAdmin: this.isSuperAdmin,
        emailVerified: !!user.emailVerified,
        providerData: [{
          email: email,
          displayName: user.displayName || user.providerData?.[0]?.displayName || '',
          photoURL: user.photoURL || user.providerData?.[0]?.photoURL || ''
        }]
      };
      this.authUser = safeUser;

      // If user is not Super Admin (Arik), automatically match profile by Gmail and lock them to it
      if (!this.isSuperAdmin && email) {
        const profiles = this.getAllUserProfiles();
        const cleanEmail = normalizeEmail(email);
        const matched = profiles.find(p => p.email && normalizeEmail(p.email) === cleanEmail);
        if (matched) {
          this.activeUser = matched.name;
          setStoredItem(STORAGE_KEYS.ACTIVE_USER, matched.name);
        }
      }
      setStoredItem('ag_auth_user', safeUser);
    } else {
      this.authUser = null;
      this.isSuperAdmin = false;
      setStoredItem('ag_auth_user', null);
    }
    this.authReady = true;
    this.notifyListeners();
  }

  setWhitelist(list) {
    const cleanList = Array.isArray(list) ? list : [];
    if (!cleanList.includes('arik.pic@gmail.com')) {
      cleanList.unshift('arik.pic@gmail.com');
    }
    this.whitelist = cleanList;
    this.notifyListeners();
  }

  addEmailToWhitelist(email) {
    if (!email) return;
    const clean = email.trim().toLowerCase();
    if (!clean.includes('@')) return;
    if (!this.whitelist.includes(clean)) {
      this.whitelist.push(clean);
      this.notifyListeners();
    }
  }

  setCustomMeals(meals) {
    this.customMeals = Array.isArray(meals) ? meals : [];
    this.notifyListeners();
  }

  getUserEmailKey() {
    if (this.authUser && this.authUser.email) {
      if (this.isSuperAdmin) {
        if (this.activeUser === 'Arik') return 'arik.pic@gmail.com';
        // If viewing Granit or other users
        const matchedProfile = this.getCurrentProfile();
        if (matchedProfile && matchedProfile.email) {
          return matchedProfile.email.toLowerCase();
        }
        const matched = this.whitelist.find(e => e.toLowerCase().includes(this.activeUser.toLowerCase()));
        if (matched) return matched;
        return `${this.activeUser.toLowerCase()}@agm-fit.com`;
      }
      return this.authUser.email.toLowerCase();
    }
    return this.activeUser === 'Arik' ? 'arik.pic@gmail.com' : `${this.activeUser.toLowerCase()}@agm-fit.com`;
  }

  canSwitchProfiles() {
    // All users of the app can switch between profiles (Arik, Granit, etc.) to view and track data
    return true;
  }

  canManageUsers() {
    return !!this.isSuperAdmin;
  }

  applyThemeToDOM(theme) {
    const validTheme = AVAILABLE_THEMES.some(t => t.id === theme) ? theme : 'light';
    const isLight = isThemeLight(validTheme);
    const mode = isLight ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', validTheme);
    document.documentElement.setAttribute('data-theme-mode', mode);
    if (document.body) {
      document.body.setAttribute('data-theme', validTheme);
      document.body.setAttribute('data-theme-mode', mode);
    }
  }

  setTheme(theme) {
    const validTheme = AVAILABLE_THEMES.some(t => t.id === theme) ? theme : 'light';
    this.theme = validTheme;
    setStoredItem('ag_theme', validTheme);
    this.applyThemeToDOM(validTheme);
    this.notifyListeners();
  }

  setThemeModalOpen(isOpen) {
    this.isThemeModalOpen = !!isOpen;
    this.notifyListeners();
  }

  setActiveUser(user) {
    // Non-super-admin users are locked to their own profile and cannot switch
    if (!this.isSuperAdmin) {
      const myEmail = this.authUser?.email?.trim().toLowerCase();
      if (myEmail) {
        const profiles = this.getAllUserProfiles();
        const myProfile = profiles.find(p => p.email && p.email.trim().toLowerCase() === myEmail);
        if (myProfile && user !== myProfile.name) {
          console.warn(`Access denied: Profile locked to ${myProfile.name}. Only Super Admin (Arik) can switch profiles.`);
          return;
        }
      }
    }
    const list = getAllUserKeys();
    if (list.includes(user)) {
      this.activeUser = user;
      setStoredItem(STORAGE_KEYS.ACTIVE_USER, user);
      this.notifyListeners();
    }
  }

  createUser(profileData, isSelfCreation = false) {
    if (!this.isSuperAdmin && !isSelfCreation) {
      console.warn('Access denied: Only Super Admin (Arik) can create new users.');
      return null;
    }
    const newProfile = createUserProfile(profileData);
    if (newProfile && newProfile.name) {
      if (newProfile.email) {
        this.addEmailToWhitelist(newProfile.email);
        import('./firebase.js').then(({ addEmailToWhitelist }) => {
          addEmailToWhitelist(newProfile.email).catch(e => console.warn('Cloud whitelist add notice:', e));
        });
      }
      this.syncCustomProfilesToCloud();
      this.activeUser = newProfile.name;
      setStoredItem(STORAGE_KEYS.ACTIVE_USER, newProfile.name);
      this.notifyListeners();
    }
    return newProfile;
  }

  deleteUser(userName) {
    if (!this.isSuperAdmin) {
      console.warn('Access denied: Only Super Admin (Arik) can delete users.');
      return false;
    }
    if (userName === 'Arik' || userName === 'Granit' || userName === 'Maor') return false;
    const profileToDelete = getUserProfile(userName);
    const emailToDelete = profileToDelete?.email;

    const ok = deleteUserProfile(userName);
    if (ok) {
      if (emailToDelete) {
        this.whitelist = this.whitelist.filter(e => normalizeEmail(e) !== normalizeEmail(emailToDelete));
        import('./firebase.js').then(({ removeEmailFromWhitelist }) => {
          removeEmailFromWhitelist(emailToDelete).catch(e => console.warn('Cloud whitelist remove notice:', e));
        });
      }
      this.syncCustomProfilesToCloud();
      if (this.activeUser === userName) {
        this.activeUser = 'Arik';
        setStoredItem(STORAGE_KEYS.ACTIVE_USER, 'Arik');
      }
      this.notifyListeners();
    }
    return ok;
  }

  syncCustomProfilesToCloud() {
    const customProfiles = this.getAllUserProfiles().filter(p => p.name !== 'Arik');
    import('./firebase.js').then(({ syncProfilesToCloud }) => {
      syncProfilesToCloud(customProfiles).catch(e => console.warn('Cloud custom profiles sync notice:', e));
    });
  }

  mergeCloudCustomProfiles(cloudProfiles) {
    if (!Array.isArray(cloudProfiles)) return;
    const cloudProfileNames = new Set(cloudProfiles.map(p => p && p.name).filter(Boolean));
    const allLocalKeys = getAllUserKeys();
    let changed = false;

    // Prune locally cached custom profiles that were deleted in the cloud (keep Arik, Granit & Maor)
    for (const key of allLocalKeys) {
      if (key !== 'Arik' && key !== 'Granit' && key !== 'Maor' && !cloudProfileNames.has(key)) {
        deleteUserProfile(key);
        changed = true;
      }
    }

    // Merge or update profiles from cloud
    for (const cp of cloudProfiles) {
      if (!cp || !cp.name || cp.name === 'Arik') continue;
      const existing = getUserProfile(cp.name);
      if (!existing || existing.name !== cp.name) {
        createUserProfile(cp);
        changed = true;
      } else {
        saveUserProfile(cp.name, cp);
        changed = true;
      }
      if (cp.email) {
        this.addEmailToWhitelist(cp.email);
      }
    }
    if (changed) {
      this.notifyListeners();
    }
  }

  getAllUserProfiles() {
    const keys = getAllUserKeys();
    return keys.map(k => getUserProfile(k));
  }

  setSelectedDate(dateStr) {
    this.selectedDate = dateStr;
    setStoredItem(STORAGE_KEYS.SELECTED_DATE, dateStr);
    this.notifyListeners();
  }

  setActiveTab(tabName) {
    this.activeTab = tabName;
    this.notifyListeners();
  }

  setProfileModalOpen(isOpen) {
    this.isProfileModalOpen = !!isOpen;
    this.notifyListeners();
  }

  getCurrentProfile() {
    return getUserProfile(this.activeUser);
  }

  updateCurrentProfile(data) {
    if (data && data.email) {
      this.addEmailToWhitelist(data.email);
      import('./firebase.js').then(({ addEmailToWhitelist }) => {
        addEmailToWhitelist(data.email).catch(e => console.warn('Cloud whitelist add notice:', e));
      });
    }
    const updated = saveUserProfile(this.activeUser, data);
    this.syncCustomProfilesToCloud();
    this.notifyListeners();
    return updated;
  }

  resetCurrentProfile() {
    const reset = resetUserProfile(this.activeUser);
    this.notifyListeners();
    return reset;
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notifyListeners() {
    for (const listener of this.listeners) {
      try {
        listener(this);
      } catch (err) {
        console.error('State listener error:', err);
      }
    }
  }
}

export const state = new AppState();
