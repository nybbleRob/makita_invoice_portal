import React, { useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';

const ALLOWED_MINUTES = [15, 30, 45, 60, 120];
const THROTTLE_MS = 1000;

export default function InactivityLogout() {
  const { isAuthenticated, logout } = useAuth();
  const { settings } = useSettings();
  const timeoutRef = useRef(null);
  const throttleRef = useRef(null);

  useEffect(() => {
    const minutes = settings?.inactivityTimeoutMinutes;
    const enabled = isAuthenticated && minutes != null && ALLOWED_MINUTES.includes(minutes);

    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      return;
    }

    const scheduleLogout = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        logout();
      }, minutes * 60 * 1000);
    };

    const onActivity = () => {
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
      }, THROTTLE_MS);
      scheduleLogout();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        scheduleLogout();
      }
    };

    scheduleLogout();

    const events = ['mousemove', 'keydown', 'mousedown', 'click', 'scroll', 'touchstart'];
    events.forEach((ev) => window.addEventListener(ev, onActivity));
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (throttleRef.current) {
        clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isAuthenticated, settings?.inactivityTimeoutMinutes, logout]);

  return null;
}
