/**
 * 简易弹幕渲染器
 * 无需额外依赖，基于 DOM 动画实现弹幕效果
 */

export interface DanmakuRenderItem {
  text: string;
  time: number;
  color: string;
  mode: number; // 0=滚动 1=顶部 2=底部
}

interface ActiveDanmaku {
  el: HTMLElement;
  mode: number;
  startTime: number;
  duration: number;
  track?: number;
}

export function createSimpleDanmaku(
  container: HTMLElement,
  data: DanmakuRenderItem[],
  artPlayer: any
) {
  let isHidden = false;
  let rafId: number | null = null;
  const activeDanmaku: ActiveDanmaku[] = [];
  const FONT_SIZE = 22;
  const LINE_HEIGHT = FONT_SIZE + 6;
  const SCROLL_DURATION = 8000; // ms
  const STATIC_DURATION = 4000; // ms
  const MAX_TRACKS = 12;

  // 已占用的轨道（滚动/顶部/底部）
  const scrollTracks = new Array(MAX_TRACKS).fill(0); // 0 = 空闲，> 0 = 占用结束时间
  const topTracks = new Array(MAX_TRACKS).fill(0);
  const bottomTracks = new Array(MAX_TRACKS).fill(0);

  function getContainerSize() {
    return {
      w: container.offsetWidth || 640,
      h: container.offsetHeight || 360,
    };
  }

  function getFreeTrack(
    tracks: number[],
    now: number,
    maxTracks: number
  ): number {
    for (let i = 0; i < maxTracks; i++) {
      if (tracks[i] <= now) return i;
    }
    return Math.floor(Math.random() * maxTracks); // 全满时随机
  }

  function spawnDanmaku(item: DanmakuRenderItem) {
    if (isHidden) return;
    const { w, h } = getContainerSize();
    const now = performance.now();

    const el = document.createElement('span');
    el.textContent = item.text;
    el.style.cssText = `
      position: absolute;
      white-space: nowrap;
      font-size: ${FONT_SIZE}px;
      font-weight: bold;
      color: ${item.color};
      text-shadow: 1px 1px 2px #000, -1px -1px 2px #000;
      pointer-events: none;
      will-change: transform;
      line-height: 1;
      user-select: none;
    `;
    container.appendChild(el);

    const elW = el.offsetWidth || item.text.length * FONT_SIZE * 0.6;

    let top = 0;
    let trackIndex = 0;

    if (item.mode === 0) {
      // 滚动弹幕
      trackIndex = getFreeTrack(scrollTracks, now, MAX_TRACKS);
      top = trackIndex * LINE_HEIGHT + 4;
      if (top + LINE_HEIGHT > h * 0.85) top = (trackIndex % 8) * LINE_HEIGHT + 4;
      scrollTracks[trackIndex] = now + SCROLL_DURATION;

      el.style.left = `${w}px`;
      el.style.top = `${top}px`;
      el.style.transition = `transform ${SCROLL_DURATION}ms linear`;

      // Force reflow
      el.getBoundingClientRect();
      el.style.transform = `translateX(${-(w + elW + 20)}px)`;
    } else if (item.mode === 1) {
      // 顶部静止
      trackIndex = getFreeTrack(topTracks, now, 6);
      top = trackIndex * LINE_HEIGHT + 4;
      topTracks[trackIndex] = now + STATIC_DURATION;

      el.style.top = `${top}px`;
      el.style.left = `${(w - elW) / 2}px`;
    } else {
      // 底部静止
      trackIndex = getFreeTrack(bottomTracks, now, 6);
      top = h - (trackIndex + 1) * LINE_HEIGHT - 4;
      bottomTracks[trackIndex] = now + STATIC_DURATION;

      el.style.bottom = `${(trackIndex) * LINE_HEIGHT + 4}px`;
      el.style.left = `${(w - elW) / 2}px`;
    }

    const duration = item.mode === 0 ? SCROLL_DURATION : STATIC_DURATION;
    activeDanmaku.push({ el, mode: item.mode, startTime: now, duration, track: trackIndex });

    // 到时删除
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
      const idx = activeDanmaku.findIndex((d) => d.el === el);
      if (idx !== -1) activeDanmaku.splice(idx, 1);
    }, duration + 200);
  }

  // 监听视频时间，派发弹幕
  let lastTime = -1;
  const sorted = [...data].sort((a, b) => a.time - b.time);
  let pointer = 0;

  function onTimeUpdate() {
    const currentTime = artPlayer.currentTime || 0;

    // 如果跳转了，重置指针
    if (Math.abs(currentTime - lastTime) > 2) {
      pointer = sorted.findIndex((d) => d.time >= currentTime);
      if (pointer === -1) pointer = sorted.length;
    }
    lastTime = currentTime;

    while (pointer < sorted.length && sorted[pointer].time <= currentTime + 0.2) {
      const item = sorted[pointer];
      if (item.time >= currentTime - 0.5) {
        spawnDanmaku(item);
      }
      pointer++;
    }
  }

  artPlayer.on('video:timeupdate', onTimeUpdate);
  artPlayer.on('video:seeking', () => {
    // 清空当前弹幕
    activeDanmaku.forEach(({ el }) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    activeDanmaku.length = 0;
    pointer = 0;
    lastTime = -1;
  });

  return {
    show() {
      isHidden = false;
      container.style.display = '';
    },
    hide() {
      isHidden = true;
      container.style.display = 'none';
    },
    destroy() {
      artPlayer.off('video:timeupdate', onTimeUpdate);
      activeDanmaku.forEach(({ el }) => {
        if (el.parentNode) el.parentNode.removeChild(el);
      });
      activeDanmaku.length = 0;
      if (container.parentNode) container.parentNode.removeChild(container);
      if (rafId !== null) cancelAnimationFrame(rafId);
    },
  };
}
