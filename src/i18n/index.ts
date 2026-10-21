// English is served at /, Simplified Chinese at /zh. Components read the language from the URL,
// so pages don't need to pass it around.

export type Lang = 'en' | 'zh';
export const langs: Lang[] = ['en', 'zh'];
export const htmlLang: Record<Lang, string> = { en: 'en', zh: 'zh-Hans' };
export const ogLocale: Record<Lang, string> = { en: 'en_US', zh: 'zh_CN' };

/** Clean URL path of the current page: '/', '/about', '/zh/projects/court-dreams'. */
export function cleanPath(url: URL): string {
  // Pages build to *.html (build.format 'file') but are served at clean URLs.
  return url.pathname.replace(/(\/index)?\.html$/, '').replace(/(.)\/$/, '$1') || '/';
}

export function langFromUrl(url: URL): Lang {
  return /^\/zh(\/|$)/.test(cleanPath(url)) ? 'zh' : 'en';
}

/** Path without the language prefix: '/zh/about' → '/about', '/zh' → '/'. */
export function basePath(url: URL): string {
  const p = cleanPath(url);
  return p.replace(/^\/zh(?=\/|$)/, '') || '/';
}

/** Whether a page exists in Chinese. The podcast has Chinese pages too (episodes without a
 *  Chinese edition fall back to English there); the RSS feed is English-only. */
export function hasTranslation(path: string): boolean {
  if (path.endsWith('.xml')) return false;
  return path === '/' || path.startsWith('/#') || path === '/about' || path.startsWith('/projects/') || path === '/podcast' || path.startsWith('/podcast/');
}

/** Localise an English path ('/', '/about', '/#work', '/projects/x') for `lang`.
 *  Paths without a Chinese version stay English. */
export function localize(path: string, lang: Lang): string {
  if (lang === 'en' || !hasTranslation(path)) return path;
  if (path === '/') return '/zh';
  if (path.startsWith('/#')) return `/zh${path.slice(1)}`;
  return `/zh${path}`;
}

const dict = {
  en: {
    'meta.defaultTitle': 'Photography',
    'meta.description':
      'Michael Wang — street, documentary and portrait photography from New York, Tokyo and beyond. Raw, cinematic, intentional.',
    skip: 'Skip to content',
    'nav.home': 'Home',
    'nav.portfolio': 'Portfolio',
    'nav.about': 'About Me',
    'nav.podcast': 'Podcast',
    'podcast.eyebrow': 'Podcast',
    'podcast.title': 'Market Brief',
    'podcast.description':
      'A short spoken summary of the day in AI infrastructure, chips and markets: the main signal, the takeaways and the numbers worth remembering, with links to the original reporting. News summary, not investment advice.',
    'podcast.rss': 'Subscribe with RSS',
    'podcast.empty': 'No episodes yet.',
    'podcast.listLabel': 'Episodes, newest first',
    'podcast.play': 'Play: {title}',
    'podcast.showNotes': 'Show notes',
    'podcast.showNotesFor': 'Show notes: {title}',
    'podcast.allEpisodes': 'All episodes',
    'podcast.listen': 'Listen · narrated brief',
    'podcast.tickers': 'Tickers mentioned',
    'podcast.sources': 'Sources',
    'podcast.charts': 'Charts',
    'podcast.chartsIntro': 'Charts in the original reporting, linked at their source.',
    'podcast.more': 'More episodes',
    'podcast.older': 'Older',
    'podcast.newer': 'Newer',
    'podcast.disclaimer': 'News summary, not investment advice.',
    'podcast.noZh': '',
    'subscribe.heading': 'Get the brief by email',
    'subscribe.note': 'Each new brief, straight to your inbox. Reply to any email to unsubscribe.',
    'subscribe.email': 'Email address',
    'subscribe.button': 'Subscribe',
    'subscribe.sending': 'Subscribing…',
    'subscribe.success': 'You’re on the list. The next brief will land in your inbox.',
    'subscribe.error': 'Something went wrong. Please try again, or email {email} to subscribe.',
    'podcast.kind.daily': 'daily',
    'podcast.kind.weekly': 'weekly',
    'podcast.min': '{n} min',
    'chart.source': 'Source',
    'chart.by': 'Chart: Michael Wang.',
    'chart.official': 'Official figures.',
    'chart.twoSources': 'Figures confirmed by two independent sources.',
    'chart.sources': 'Sources:',
    'header.home': 'Michael Wang — home',
    'header.instagram': 'Instagram (opens in a new tab)',
    'header.openMenu': 'Open menu',
    'header.closeMenu': 'Close menu',
    'header.menu': 'Site menu',
    'header.primary': 'Primary',
    'lang.switch': '中文',
    'lang.switchLabel': '切换到中文版',
    'theme.toLight': 'Switch to light theme',
    'theme.toDark': 'Switch to dark theme',
    'footer.tel': 'Tel:',
    'footer.rights': 'All photographs © {name}.',
    'home.h1': 'Photography portfolio',
    'home.eyebrow': 'Portfolio',
    'home.selected': 'Selected projects',
    'home.work': 'Work',
    'hero.label': 'Featured photographs',
    'hero.slideOf': '{i} of {n}',
    'hero.choose': 'Choose slide',
    'hero.show': 'Show slide {i}',
    'hero.prev': 'Previous slide',
    'hero.next': 'Next slide',
    'hero.pause': 'Pause slideshow',
    'hero.play': 'Play slideshow',
    'grid.filterLabel': 'Filter projects by category',
    'grid.all': 'All',
    'grid.allCategories': 'all categories',
    'grid.status': 'Showing {n} {projects} in {label}.',
    'grid.project': 'project',
    'grid.projects': 'projects',
    'cat.Street': 'Street',
    'cat.Events': 'Events',
    'cat.Portraits': 'Portraits',
    'cat.Travel': 'Travel',
    'cat.Food': 'Food',
    'project.allWork': 'All work',
    'project.type': 'Project Type',
    'project.date': 'Date',
    'project.location': 'Location',
    'project.byline': '{title} — photography by Michael Wang',
    'project.photos': '{title} — photographs',
    'project.photo': '{title}, photograph {n}',
    'project.cover': '{title} — cover photograph',
    'nav.more': 'More projects',
    'nav.prevProject': 'Previous project',
    'nav.nextProject': 'Next project',
    'lightbox.label': 'Photo viewer',
    'lightbox.open': 'Open photograph {i} of {n} in viewer',
    'lightbox.close': 'Close viewer',
    'lightbox.prev': 'Previous photograph',
    'lightbox.next': 'Next photograph',
    'about.title': 'About',
    'about.description':
      'About Michael Wang — a photographer documenting life the way he experiences it: raw, cinematic and intentional, from sweeping skylines to intimate portraits. Get in touch.',
    'about.heading': 'About Me',
    'about.contact': 'Contact',
    'about.getInTouch': 'Get in touch',
    'form.first': 'First name',
    'form.last': 'Last name',
    'form.email': 'Email',
    'form.message': 'Message',
    'form.submit': 'Submit',
    'form.notConnected': 'The contact form isn’t connected yet. In the meantime, email me at',
    'form.notConnectedJs': 'The form isn’t connected yet — please email me at {email}.',
    'form.sending': 'Sending…',
    'form.success': 'Thanks — your message is on its way. I’ll get back to you soon.',
    'form.error': 'Something went wrong sending your message. Please try again or email {email}.',
  },
  zh: {
    'meta.defaultTitle': '摄影作品集',
    'meta.description': 'Michael Wang 的街头、纪实与肖像摄影——来自纽约、东京等地。真实、电影感、有意图。',
    skip: '跳到主要内容',
    'nav.home': '首页',
    'nav.portfolio': '作品集',
    'nav.about': '关于我',
    'nav.podcast': '播客',
    'podcast.eyebrow': '播客',
    'podcast.title': '市场简报',
    'podcast.description':
      '每天几分钟，用语音梳理AI基础设施、芯片与市场：当天的主线、核心结论和值得记住的数字，并附原始报道链接。新闻摘要，不构成投资建议。',
    'podcast.rss': 'RSS 订阅（英文）',
    'podcast.empty': '暂无节目。',
    'podcast.listLabel': '节目列表，最新在前',
    'podcast.play': '播放：{title}',
    'podcast.showNotes': '节目笔记',
    'podcast.showNotesFor': '节目笔记：{title}',
    'podcast.allEpisodes': '全部节目',
    'podcast.listen': '收听 · 中文语音版',
    'podcast.tickers': '涉及股票',
    'podcast.sources': '来源',
    'podcast.charts': '图表',
    'podcast.chartsIntro': '原始报道中的图表，链接至出处。',
    'podcast.more': '更多节目',
    'podcast.older': '更早',
    'podcast.newer': '更新',
    'podcast.disclaimer': '新闻摘要，不构成投资建议。',
    'podcast.noZh': '本期暂无中文版，以下为英文原文和英文语音。',
    'subscribe.heading': '邮件订阅简报',
    'subscribe.note': '每期新简报直接发送到你的邮箱。回复任意一封邮件即可退订。',
    'subscribe.email': '邮箱地址',
    'subscribe.button': '订阅',
    'subscribe.sending': '订阅中…',
    'subscribe.success': '订阅成功！下一期简报会发送到你的邮箱。',
    'subscribe.error': '订阅失败，请重试，或发邮件至 {email} 订阅。',
    'podcast.kind.daily': '每日',
    'podcast.kind.weekly': '每周',
    'podcast.min': '{n} 分钟',
    'chart.source': '来源',
    'chart.by': '图表：Michael Wang。',
    'chart.official': '官方数据。',
    'chart.twoSources': '数据经两个独立来源核实。',
    'chart.sources': '来源：',
    'header.home': 'Michael Wang——首页',
    'header.instagram': 'Instagram（在新标签页打开）',
    'header.openMenu': '打开菜单',
    'header.closeMenu': '关闭菜单',
    'header.menu': '网站菜单',
    'header.primary': '主导航',
    'lang.switch': 'EN',
    'lang.switchLabel': 'Switch to English',
    'theme.toLight': '切换到浅色模式',
    'theme.toDark': '切换到深色模式',
    'footer.tel': '电话：',
    'footer.rights': '所有照片版权归 {name} 所有。',
    'home.h1': '摄影作品集',
    'home.eyebrow': '作品集',
    'home.selected': '精选项目',
    'home.work': '作品',
    'hero.label': '精选照片',
    'hero.slideOf': '第 {i} 张，共 {n} 张',
    'hero.choose': '选择幻灯片',
    'hero.show': '显示第 {i} 张',
    'hero.prev': '上一张',
    'hero.next': '下一张',
    'hero.pause': '暂停播放',
    'hero.play': '继续播放',
    'grid.filterLabel': '按类别筛选项目',
    'grid.all': '全部',
    'grid.allCategories': '全部类别',
    'grid.status': '{label}：共 {n} 个项目。',
    'grid.project': '项目',
    'grid.projects': '项目',
    'cat.Street': '街头',
    'cat.Events': '活动',
    'cat.Portraits': '肖像',
    'cat.Travel': '旅行',
    'cat.Food': '美食',
    'project.allWork': '全部作品',
    'project.type': '项目类型',
    'project.date': '日期',
    'project.location': '地点',
    'project.byline': '{title}——Michael Wang 摄影作品',
    'project.photos': '{title}——照片',
    'project.photo': '{title}，第 {n} 张照片',
    'project.cover': '{title}——封面照片',
    'nav.more': '更多项目',
    'nav.prevProject': '上一个项目',
    'nav.nextProject': '下一个项目',
    'lightbox.label': '照片查看器',
    'lightbox.open': '在查看器中打开第 {i} 张照片（共 {n} 张）',
    'lightbox.close': '关闭查看器',
    'lightbox.prev': '上一张照片',
    'lightbox.next': '下一张照片',
    'about.title': '关于我',
    'about.description':
      '关于 Michael Wang——一位以真实、电影感、有意图的方式记录生活的摄影师，从壮阔天际线到亲密肖像。欢迎联系。',
    'about.heading': '关于我',
    'about.contact': '联系',
    'about.getInTouch': '联系我',
    'form.first': '名',
    'form.last': '姓',
    'form.email': '邮箱',
    'form.message': '留言',
    'form.submit': '发送',
    'form.notConnected': '联系表单暂未开通。你可以先发邮件给我：',
    'form.notConnectedJs': '表单暂未开通——请发邮件至 {email}。',
    'form.sending': '发送中…',
    'form.success': '谢谢！你的留言已发送，我会尽快回复。',
    'form.error': '留言发送失败，请重试，或直接发邮件至 {email}。',
  },
} satisfies Record<Lang, Record<string, string>>;

export type Key = keyof (typeof dict)['en'];

/** Translator for a language: t('hero.show', { i: 2 }). */
export function useT(lang: Lang) {
  return (key: Key, vars: Record<string, string | number> = {}) =>
    dict[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}
