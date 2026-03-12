/**
 * 弹幕服务 - 基于弹弹Play API
 * 通过标题和集数匹配弹幕数据
 */

export interface DanmakuComment {
  p: string; // 格式: "时间,类型,颜色,用户ID"
  m: string; // 弹幕内容
}

export interface DanmakuItem {
  time: number;
  type: number;
  color: string;
  author: string;
  text: string;
}

interface DandanMatchResult {
  animeId: number;
  animeTitle: string;
  episodeId: number;
  episodeTitle: string;
  type: string;
  typeDescription: string;
  shift: number;
}

interface DandanSearchAnime {
  animeId: number;
  animeTitle: string;
  type: string;
  typeDescription: string;
  episodes: {
    episodeId: number;
    episodeTitle: string;
  }[];
}

/**
 * 通过标题搜索动漫
 */
async function searchAnime(title: string): Promise<DandanSearchAnime[]> {
  try {
    const res = await fetch(
      `https://api.dandanplay.net/api/v2/search/anime?keyword=${encodeURIComponent(title)}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'MoonTV/1.0',
        },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.animes || [];
  } catch {
    return [];
  }
}

/**
 * 通过文件信息匹配弹幕源（精确匹配）
 */
async function matchEpisode(
  fileName: string,
  fileHash: string = '',
  fileSize: number = 0
): Promise<DandanMatchResult | null> {
  try {
    const body: Record<string, string | number> = { fileName };
    if (fileHash) body.fileHash = fileHash;
    if (fileSize) body.fileSize = fileSize;

    const res = await fetch('https://api.dandanplay.net/api/v2/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'MoonTV/1.0',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.isMatched && data.matches?.length > 0) {
      return data.matches[0];
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 获取指定剧集的弹幕
 */
async function fetchDanmakuByEpisodeId(
  episodeId: number,
  withRelated: boolean = true
): Promise<DanmakuComment[]> {
  try {
    const url = `https://api.dandanplay.net/api/v2/comment/${episodeId}?withRelated=${withRelated}&chConvert=1`;
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MoonTV/1.0',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.comments || [];
  } catch {
    return [];
  }
}

/**
 * 将弹弹Play弹幕格式转为Artplayer弹幕格式
 */
function convertDanmaku(comments: DanmakuComment[]): DanmakuItem[] {
  return comments
    .map((c) => {
      const parts = c.p.split(',');
      if (parts.length < 4) return null;
      const time = parseFloat(parts[0]);
      const type = parseInt(parts[1], 10);
      const colorNum = parseInt(parts[2], 10);
      const author = parts[3];

      // 将数字颜色转为十六进制
      const r = (colorNum >> 16) & 0xff;
      const g = (colorNum >> 8) & 0xff;
      const b = colorNum & 0xff;
      const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;

      return {
        time,
        type, // 1=滚动 4=底部 5=顶部
        color,
        author,
        text: c.m,
      } as DanmakuItem;
    })
    .filter(Boolean) as DanmakuItem[];
}

/**
 * 主函数：根据视频标题和集数获取弹幕
 */
export async function getDanmaku(
  title: string,
  episodeIndex: number = 0,
  year?: string
): Promise<DanmakuItem[]> {
  try {
    // 构造文件名用于匹配（格式：标题 + 集数）
    const episodeNum = episodeIndex + 1;
    const paddedEp = episodeNum.toString().padStart(2, '0');
    const fileName = `${title} E${paddedEp}`;

    // 先尝试文件名匹配
    const matchResult = await matchEpisode(fileName);
    if (matchResult) {
      const comments = await fetchDanmakuByEpisodeId(matchResult.episodeId);
      if (comments.length > 0) {
        return convertDanmaku(comments);
      }
    }

    // 降级：搜索匹配
    const animes = await searchAnime(title);
    if (!animes || animes.length === 0) return [];

    // 优先匹配年份
    let targetAnime = animes[0];
    if (year) {
      const yearNum = parseInt(year, 10);
      const yearMatch = animes.find((a) => {
        // DanDan API 中 animeTitle 有时包含年份信息
        return a.animeTitle.includes(year) || Math.abs(yearNum) < 5;
      });
      if (yearMatch) targetAnime = yearMatch;
    }

    // 找到对应集数
    const episode = targetAnime.episodes?.[episodeIndex];
    if (!episode) {
      // 如果没有对应集数，尝试第一集
      const fallbackEpisode = targetAnime.episodes?.[0];
      if (!fallbackEpisode) return [];
      const comments = await fetchDanmakuByEpisodeId(fallbackEpisode.episodeId);
      return convertDanmaku(comments);
    }

    const comments = await fetchDanmakuByEpisodeId(episode.episodeId);
    return convertDanmaku(comments);
  } catch (err) {
    console.warn('[Danmaku] 获取弹幕失败:', err);
    return [];
  }
}

/**
 * 将 DanmakuItem 转为 artplayer-plugin-danmuku 格式
 */
export function toArtplayerDanmaku(items: DanmakuItem[]) {
  return items.map((item) => ({
    text: item.text,
    time: item.time,
    color: item.color,
    border: false,
    // Artplayer danmuku mode: 0=滚动 1=顶部 2=底部
    mode:
      item.type === 4
        ? 2 // 底部
        : item.type === 5
          ? 1 // 顶部
          : 0, // 默认滚动
  }));
}
