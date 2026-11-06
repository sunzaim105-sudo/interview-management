import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import { ROLE_HOME, USER_STATUS } from '../lib/roles';

const AuthContext = createContext(null);

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, username, user_id, user_role, email, status')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const clearAuth = useCallback(async () => {
    setProfile(null);
    setSession(null);
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const nextSession = data.session;
      if (!nextSession?.user) {
        await clearAuth();
        return;
      }

      const nextProfile = await fetchProfile(nextSession.user.id);

      if (!nextProfile || nextProfile.status !== USER_STATUS.ALLOWED) {
        await supabase.auth.signOut();
        await clearAuth();
        return;
      }

      setSession(nextSession);
      setProfile(nextProfile);
    } catch (error) {
      console.error('Failed to restore session', error);
      await supabase.auth.signOut();
      await clearAuth();
    } finally {
      setLoading(false);
    }
  }, [clearAuth]);

  useEffect(() => {
    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      if (event === 'SIGNED_OUT' || !nextSession?.user) {
        setSession(null);
        setProfile(null);
        setLoading(false);
        return;
      }

      // Avoid racing with explicit signIn/signUp flows
      if (event === 'INITIAL_SESSION') return;

      try {
        const nextProfile = await fetchProfile(nextSession.user.id);
        if (!nextProfile || nextProfile.status !== USER_STATUS.ALLOWED) {
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
          return;
        }
        setSession(nextSession);
        setProfile(nextProfile);
      } catch (error) {
        console.error('Auth state sync failed', error);
      } finally {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [loadSession]);

  const signUp = useCallback(async ({ email, username, userId, password }) => {
    const displayName = username.trim();
    const loginId = String(userId || '').trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!displayName) {
      throw new Error('User name is required.');
    }
    if (!loginId) {
      throw new Error('User ID is required.');
    }

    const availableRes = await fetch('/api/auth/user-id-available', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: loginId }),
    });
    const availableBody = await availableRes.json().catch(() => ({}));
    if (!availableRes.ok) {
      throw new Error(availableBody.error || 'Could not verify User ID.');
    }
    if (!availableBody.data?.available) {
      throw new Error(
        'That User ID is already taken. Choose a different unique User ID.',
      );
    }

    const { data, error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          username: displayName,
          user_id: loginId,
          user_role: 'caller',
        },
      },
    });

    if (error) throw error;

    // Supabase returns a user with empty identities when the email already exists.
    if (!data.user?.id || !(data.user.identities || []).length) {
      throw new Error(
        'An account with this email already exists. Try signing in instead.',
      );
    }

    // Always ensure public.users row (DB trigger can be missing / fail).
    const signupToken = data.session?.access_token || '';
    const profileRes = await fetch('/api/auth/register-profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(signupToken ? { Authorization: `Bearer ${signupToken}` } : {}),
      },
      body: JSON.stringify({
        id: data.user.id,
        email: normalizedEmail,
        username: displayName,
        user_id: loginId,
        user_role: 'caller',
        ...(signupToken ? { accessToken: signupToken } : {}),
      }),
    });
    const profileBody = await profileRes.json().catch(() => ({}));
    if (!profileRes.ok) {
      throw new Error(
        profileBody.error ||
          'Account was created in Auth but profile registration failed. Contact an admin.',
      );
    }

    // Signup sessions are pending until an admin approves — never keep them signed in.
    if (data.session) {
      await supabase.auth.signOut();
    }

    return {
      user: data.user,
      message:
        'Account created. An admin must approve your account before you can sign in.',
    };
  }, []);

  const signIn = useCallback(async ({ userId, password }) => {
    const loginId = userId.trim();

    const { data: email, error: lookupError } = await supabase.rpc(
      'get_email_by_user_id',
      { p_user_id: loginId },
    );

    if (lookupError) throw lookupError;
    if (!email) {
      throw new Error('Invalid user ID or password.');
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (msg.includes('email not confirmed') || msg.includes('not confirmed')) {
        throw new Error(
          'Your email is not confirmed yet. Ask an admin to confirm your account, then try again.',
        );
      }
      throw new Error('Invalid user ID or password.');
    }

    const nextProfile = await fetchProfile(data.user.id);

    if (!nextProfile) {
      await supabase.auth.signOut();
      throw new Error('User profile not found. Contact an admin.');
    }

    if (nextProfile.status === USER_STATUS.PENDING) {
      await supabase.auth.signOut();
      throw new Error(
        'Your account is waiting for admin approval. You cannot sign in yet.',
      );
    }

    if (nextProfile.status === USER_STATUS.BLOCKED) {
      await supabase.auth.signOut();
      throw new Error('Your account has been blocked. Contact an admin.');
    }

    if (nextProfile.status !== USER_STATUS.ALLOWED) {
      await supabase.auth.signOut();
      throw new Error('Your account is not allowed to sign in.');
    }

    setSession(data.session);
    setProfile(nextProfile);

    return {
      profile: nextProfile,
      redirectTo: ROLE_HOME[nextProfile.user_role] || '/',
    };
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    await clearAuth();
  }, [clearAuth]);

  const value = useMemo(
    () => ({
      session,
      profile,
      loading,
      isAuthenticated: Boolean(session && profile),
      signUp,
      signIn,
      signOut,
    }),
    [session, profile, loading, signUp, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
