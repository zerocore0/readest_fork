'use client';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { FcGoogle } from 'react-icons/fc';
import { FaApple } from 'react-icons/fa';
import { FaGithub } from 'react-icons/fa';
import { IoArrowBack } from 'react-icons/io5';

import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/utils/supabase';
import { useTheme } from '@/hooks/useTheme';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { isTauriAppPlatform } from '@/services/environment';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { start, cancel, onUrl, onInvalidUrl } from '@fabianlars/tauri-plugin-oauth';
import { openUrl } from '@tauri-apps/plugin-opener';
import { handleAuthCallback } from '@/helpers/auth';
import { getAppleIdAuth, Scope } from './utils/appleIdAuth';
import { authWithSafari } from './utils/safariAuth';

type OAuthProvider = 'google' | 'apple' | 'azure' | 'github';

interface SingleInstancePayload {
  args: string[];
  cwd: string;
}

interface ProviderLoginProp {
  provider: OAuthProvider;
  handleSignIn: (provider: OAuthProvider) => void;
  Icon: React.ElementType;
  label: string;
}

const WEB_AUTH_CALLBACK = 'https://web.readest.com/auth/callback';
const DEEPLINK_CALLBACK = 'readest://auth/callback';

const ProviderLogin: React.FC<ProviderLoginProp> = ({ provider, handleSignIn, Icon, label }) => {
  return (
    <button
      onClick={() => handleSignIn(provider)}
      className={clsx(
        'mb-2 flex w-64 items-center justify-center rounded border p-2.5',
        'bg-base-100 border-gray-300 shadow-sm transition hover:bg-gray-50',
      )}
    >
      <Icon />
      <span className='text-neutral-content/70 px-2 text-sm'>{label}</span>
    </button>
  );
};

export default function AuthPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { envConfig, appService } = useEnv();
  const { isDarkMode } = useTheme();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [port, setPort] = useState<number | null>(null);
  const isOAuthServerRunning = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  const getTauriRedirectTo = (isOAuth: boolean) => {
    if (process.env.NODE_ENV === 'production' || appService?.isMobile) {
      if (appService?.isIOSApp) {
        return isOAuth ? DEEPLINK_CALLBACK : WEB_AUTH_CALLBACK;
      } else if (appService?.isAndroidApp) {
        return WEB_AUTH_CALLBACK;
      }
      return DEEPLINK_CALLBACK;
    }
    return `http://localhost:${port}`; // only for development env on Desktop
  };

  const tauriSignInApple = async () => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    supabase.auth.signOut();
    const request = {
      scope: ['fullName', 'email'] as Scope[],
    };
    const appleAuthResponse = await getAppleIdAuth(request);
    if (appleAuthResponse.identityToken) {
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: appleAuthResponse.identityToken,
      });
      if (error) {
        console.error('Authentication error:', error);
      }
    }
  };

  const tauriSignIn = async (provider: OAuthProvider) => {
    if (!supabase) {
      throw new Error('No backend connected');
    }
    supabase.auth.signOut();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        skipBrowserRedirect: true,
        redirectTo: getTauriRedirectTo(true),
      },
    });

    if (error) {
      console.error('Authentication error:', error);
      return;
    }
    // Open the OAuth URL in a ASWebAuthenticationSession on iOS to comply with Apple's guidelines
    // for other platforms, open the OAuth URL in the default browser
    if (appService?.isIOSApp) {
      const res = await authWithSafari({ authUrl: data.url });
      if (res) {
        handleOAuthUrl(res.redirectUrl);
      }
    } else {
      await openUrl(data.url);
    }
  };

  const handleOAuthUrl = async (url: string) => {
    console.log('Received OAuth URL:', url);
    const hashMatch = url.match(/#(.*)/);
    if (hashMatch) {
      const hash = hashMatch[1];
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const next = params.get('next') ?? '/';
      if (accessToken) {
        handleAuthCallback({ accessToken, refreshToken, next, login, navigate: router.push });
      }
    }
  };

  const startTauriOAuth = async () => {
    try {
      if (process.env.NODE_ENV === 'production' || appService?.isMobile) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();
        currentWindow.listen('single-instance', ({ event, payload }) => {
          console.log('Received deep link:', event, payload);
          const { args } = payload as SingleInstancePayload;
          if (args?.[1]) {
            handleOAuthUrl(args[1]);
          }
        });
        await onOpenUrl((urls) => {
          urls.forEach((url) => {
            handleOAuthUrl(url);
          });
        });
      } else {
        const port = await start();
        setPort(port);
        console.log(`OAuth server started on port ${port}`);

        await onUrl(handleOAuthUrl);
        await onInvalidUrl((url) => {
          console.log('Received invalid OAuth URL:', url);
        });
      }
    } catch (error) {
      console.error('Error starting OAuth server:', error);
    }
  };

  const stopTauriOAuth = async () => {
    try {
      if (port) {
        await cancel(port);
        console.log('OAuth server stopped');
      }
    } catch (error) {
      console.error('Error stopping OAuth server:', error);
    }
  };

  const handleGoBack = () => {
    // Keep login false to avoid infinite loop to redirect to the login page
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    router.back();
  };

  const getAuthLocalization = () => {
    return {
      variables: {
        sign_in: {
          email_label: _('Email address'),
          password_label: _('Your Password'),
          email_input_placeholder: _('Your email address'),
          password_input_placeholder: _('Your password'),
          button_label: _('Sign in'),
          loading_button_label: _('Signing in...'),
          social_provider_text: _('Sign in with {{provider}}'),
          link_text: _('Already have an account? Sign in'),
        },
        sign_up: {
          email_label: _('Email address'),
          password_label: _('Create a Password'),
          email_input_placeholder: _('Your email address'),
          password_input_placeholder: _('Your password'),
          button_label: _('Sign up'),
          loading_button_label: _('Signing up...'),
          social_provider_text: _('Sign in with {{provider}}'),
          link_text: _('Don’t have an account? Sign up'),
          confirmation_text: _('Check your email for the confirmation link'),
        },
        magic_link: {
          email_input_label: _('Email address'),
          email_input_placeholder: _('Your email address'),
          button_label: _('Sign in'),
          loading_button_label: _('Signing in ...'),
          link_text: _('Send a magic link email'),
          confirmation_text: _('Check your email for the magic link'),
        },
        forgotten_password: {
          email_label: _('Email address'),
          password_label: _('Your Password'),
          email_input_placeholder: _('Your email address'),
          button_label: _('Send reset password instructions'),
          loading_button_label: _('Sending reset instructions ...'),
          link_text: _('Forgot your password?'),
          confirmation_text: _('Check your email for the password reset link'),
        },
        update_password: {
          password_label: _('New Password'),
          password_input_placeholder: _('Your new password'),
          button_label: _('Update password'),
          loading_button_label: _('Updating password ...'),
          confirmation_text: _('Your password has been updated'),
        },
        verify_otp: {
          email_input_label: _('Email address'),
          email_input_placeholder: _('Your email address'),
          phone_input_label: _('Phone number'),
          phone_input_placeholder: _('Your phone number'),
          token_input_label: _('Token'),
          token_input_placeholder: _('Your OTP token'),
          button_label: _('Verify token'),
          loading_button_label: _('Signing in ...'),
        },
      },
    };
  };

  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (isOAuthServerRunning.current) return;
    isOAuthServerRunning.current = true;

    startTauriOAuth();
    return () => {
      isOAuthServerRunning.current = false;
      stopTauriOAuth();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token && session.user) {
        login(session.access_token, session.user);
        const redirectTo = new URLSearchParams(window.location.search).get('redirect');
        router.push(redirectTo ?? '/library');
      }
    });

    return () => {
      subscription?.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  // For tauri app development, use a custom OAuth server to handle the OAuth callback
  // For tauri app production, use deeplink to handle the OAuth callback
  // For web app, use the built-in OAuth callback page /auth/callback
  return isTauriAppPlatform() ? (
    <div
      className={clsx(
        'mt-6 flex',
        appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
        appService?.hasTrafficLight && 'pt-11',
      )}
    >
      <button
        onClick={handleGoBack}
        className={clsx(
          'btn btn-ghost fixed left-4 h-8 min-h-8 w-8 p-0',
          appService?.hasSafeAreaInset && 'top-[calc(env(safe-area-inset-top)+16px)]',
          appService?.hasTrafficLight && 'top-11',
        )}
      >
        <IoArrowBack className='text-base-content' />
      </button>
      <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem' }}>
        <ProviderLogin
          provider='google'
          handleSignIn={tauriSignIn}
          Icon={FcGoogle}
          label={_('Sign in with Google')}
        />
        <ProviderLogin
          provider='apple'
          handleSignIn={appService?.isIOSApp ? tauriSignInApple : tauriSignIn}
          Icon={FaApple}
          label={_('Sign in with Apple')}
        />
        <ProviderLogin
          provider='github'
          handleSignIn={tauriSignIn}
          Icon={FaGithub}
          label={_('Sign in with GitHub')}
        />
        <hr className='my-3 mt-6 w-64 border-t border-gray-200' />
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          theme={isDarkMode ? 'dark' : 'light'}
          magicLink={true}
          providers={[]}
          redirectTo={getTauriRedirectTo(false)}
          localization={getAuthLocalization()}
        />
      </div>
    </div>
  ) : (
    <div style={{ maxWidth: '420px', margin: 'auto', padding: '2rem', paddingTop: '4rem' }}>
      <button
        onClick={handleGoBack}
        className='btn btn-ghost fixed left-6 top-6 h-8 min-h-8 w-8 p-0'
      >
        <IoArrowBack className='text-base-content' />
      </button>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        theme={isDarkMode ? 'dark' : 'light'}
        magicLink={true}
        providers={['google', 'apple', 'github']}
        redirectTo='/auth/callback'
        localization={getAuthLocalization()}
      />
    </div>
  );
}
