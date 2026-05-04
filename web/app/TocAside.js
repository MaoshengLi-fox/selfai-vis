'use client';

import { useEffect, useMemo, useState } from 'react';

export default function TocAside({ items = [] }) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [activeId, setActiveId] = useState(items[0]?.id || '');

  const ids = useMemo(() => items.map((item) => item.id), [items]);

  useEffect(() => {
    let rafId = 0;
    const timers = [];
    let pollId = 0;

    const update = () => {
      const abstract = document.getElementById('abstract');
      if (!abstract) {
        setProgress(1);
        setVisible(true);
        return;
      }

      const scrollY = window.scrollY || window.pageYOffset || 0;
      const rootStyle = getComputedStyle(document.documentElement);
      const navHeight = parseFloat(rootStyle.getPropertyValue('--nav-h')) || 52;
      const stickyTop = navHeight + 24;
      const rectTop = abstract.getBoundingClientRect().top;
      const abstractPageTop = rectTop + scrollY;
      const revealRange = 120;
      const nextProgress = Math.min(1, Math.max(0, (stickyTop + revealRange - rectTop) / revealRange));
      const shouldShow = scrollY + stickyTop >= abstractPageTop - revealRange;

      setProgress(nextProgress);
      setVisible(shouldShow);
    };

    const onScrollOrResize = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(update);
    };

    const startShortPoll = (durationMs = 3000, intervalMs = 120) => {
      if (pollId) window.clearInterval(pollId);
      const startedAt = Date.now();
      pollId = window.setInterval(() => {
        onScrollOrResize();
        if (Date.now() - startedAt >= durationMs) {
          window.clearInterval(pollId);
          pollId = 0;
        }
      }, intervalMs);
    };

    const scheduleBurstUpdate = () => {
      onScrollOrResize();
      [0, 80, 220, 450].forEach((delay) => {
        const timer = window.setTimeout(onScrollOrResize, delay);
        timers.push(timer);
      });
      startShortPoll();
    };

    scheduleBurstUpdate();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('pageshow', scheduleBurstUpdate);
    window.addEventListener('popstate', scheduleBurstUpdate);
    window.addEventListener('hashchange', scheduleBurstUpdate);
    window.addEventListener('focus', scheduleBurstUpdate);
    document.addEventListener('visibilitychange', scheduleBurstUpdate);

    return () => {
      cancelAnimationFrame(rafId);
      timers.forEach((timer) => window.clearTimeout(timer));
      if (pollId) window.clearInterval(pollId);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('pageshow', scheduleBurstUpdate);
      window.removeEventListener('popstate', scheduleBurstUpdate);
      window.removeEventListener('hashchange', scheduleBurstUpdate);
      window.removeEventListener('focus', scheduleBurstUpdate);
      document.removeEventListener('visibilitychange', scheduleBurstUpdate);
    };
  }, []);

  useEffect(() => {
    if (!ids.length) return undefined;

    const observed = ids
      .map((id) => document.getElementById(id))
      .filter(Boolean);

    if (!observed.length) return undefined;

    let rafId = 0;
    const timers = [];

    const updateActive = () => {
      const threshold = 120;
      const entries = observed
        .map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
        .filter((entry) => !Number.isNaN(entry.top));

      const visibleEntries = entries.filter((entry) => entry.top <= threshold);
      if (visibleEntries.length) {
        setActiveId(visibleEntries[visibleEntries.length - 1].id);
      } else {
        setActiveId(entries[0]?.id || '');
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateActive);
    };

    const scheduleActiveBurst = () => {
      onScroll();
      [0, 80, 220, 450].forEach((delay) => {
        const timer = window.setTimeout(onScroll, delay);
        timers.push(timer);
      });
    };

    scheduleActiveBurst();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('pageshow', scheduleActiveBurst);
    window.addEventListener('popstate', scheduleActiveBurst);
    window.addEventListener('hashchange', scheduleActiveBurst);

    return () => {
      cancelAnimationFrame(rafId);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('pageshow', scheduleActiveBurst);
      window.removeEventListener('popstate', scheduleActiveBurst);
      window.removeEventListener('hashchange', scheduleActiveBurst);
    };
  }, [ids]);

  return (
    <aside
      className={`toc ${visible ? 'visible' : ''}`}
      aria-hidden={!visible}
      style={{
        opacity: visible ? Math.max(progress, 0.12) : 0,
        transform: `translateY(${Math.round((1 - progress) * 8)}px)`
      }}
    >
      <div className="toc-label">On this page</div>
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={`${item.level === 1 ? 'sub' : ''} ${activeId === item.id ? 'active' : ''}`.trim()}
        >
          {item.title}
        </a>
      ))}
    </aside>
  );
}
