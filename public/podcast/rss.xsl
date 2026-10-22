<?xml version="1.0" encoding="utf-8"?>
<!--
  Makes /podcast/rss.xml readable when someone opens it in a browser. Podcast apps and feed
  readers ignore this stylesheet and read the raw feed as usual.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <xsl:output method="html" encoding="utf-8" indent="yes" />
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title><xsl:value-of select="/rss/channel/title" /> · RSS feed</title>
        <style>
          :root { --bg: #0b0b0c; --fg: #ececec; --muted: #9a9a9e; --line: #2a2a2e; --chip: #18181b; color-scheme: dark; }
          @media (prefers-color-scheme: light) { :root { --bg: #fafaf9; --fg: #161616; --muted: #5f5f66; --line: #e2e2e4; --chip: #f0f0ef; color-scheme: light; } }
          * { box-sizing: border-box; }
          body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 Inter, -apple-system, "Segoe UI", "PingFang SC", sans-serif; }
          main { max-width: 760px; margin: 0 auto; padding: 56px max(20px, env(safe-area-inset-left)) 72px; }
          .eyebrow { font-size: 0.6875rem; letter-spacing: 0.24em; text-transform: uppercase; color: var(--muted); margin: 0 0 14px; }
          h1 { font-weight: 400; font-size: clamp(2rem, 1.4rem + 3vw, 3.2rem); line-height: 1.05; letter-spacing: -0.02em; margin: 0; }
          .lede { color: var(--muted); margin: 18px 0 0; max-width: 38em; }
          .how { margin: 28px 0 0; padding: 16px 18px; background: var(--chip); border: 1px solid var(--line); border-radius: 4px; font-size: 0.9375rem; }
          .how p { margin: 0 0 10px; }
          .how p:last-child { margin: 0; }
          .url { display: block; font-family: ui-monospace, Menlo, monospace; font-size: 0.875rem; overflow-wrap: anywhere; user-select: all; padding: 8px 10px; border: 1px solid var(--line); border-radius: 3px; background: var(--bg); }
          a { color: inherit; text-underline-offset: 0.2em; }
          ol { list-style: none; margin: 40px 0 0; padding: 0; border-top: 1px solid var(--line); }
          li { padding: 22px 0; border-bottom: 1px solid var(--line); }
          .meta { font-size: 0.8125rem; color: var(--muted); margin: 0 0 6px; }
          .title { font-size: 1.125rem; font-weight: 500; margin: 0 0 6px; }
          .desc { margin: 0 0 12px; color: var(--muted); }
          audio { width: 100%; height: 40px; }
          .back { display: inline-block; margin-top: 32px; font-size: 0.875rem; }
        </style>
      </head>
      <body>
        <main>
          <p class="eyebrow">Podcast feed · 播客订阅源</p>
          <h1><xsl:value-of select="/rss/channel/title" /></h1>
          <p class="lede"><xsl:value-of select="/rss/channel/description" /></p>
          <div class="how">
            <p><strong>This is an RSS feed.</strong> Copy the address below into a podcast app (Apple Podcasts: Library → ⋯ → Follow a Show by URL; Overcast, Pocket Casts and most readers have “Add URL”) to get every new episode automatically.</p>
            <p>这是RSS订阅源。把下面的地址复制到播客或RSS阅读器中（“通过URL添加”），即可自动收到每一期新节目。</p>
            <span class="url"><xsl:value-of select="/rss/channel/atom:link/@href" xmlns:atom="http://www.w3.org/2005/Atom" /></span>
          </div>
          <ol>
            <xsl:for-each select="/rss/channel/item">
              <li>
                <p class="meta">
                  <xsl:value-of select="substring(pubDate, 1, 16)" />
                  <xsl:if test="itunes:duration"> · <xsl:value-of select="itunes:duration" /></xsl:if>
                </p>
                <p class="title"><a href="{link}"><xsl:value-of select="title" /></a></p>
                <p class="desc"><xsl:value-of select="description" /></p>
                <audio controls="controls" preload="none" src="{enclosure/@url}"></audio>
              </li>
            </xsl:for-each>
          </ol>
          <a class="back" href="{/rss/channel/link}">← Back to the podcast page</a>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
