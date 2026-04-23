const state = {
  loading: true,
  error: '',
  summary: null,
};

function log(event, payload = {}) {
  console.log(`[AdminViz] ${event}`, payload);
}

const numberFormat = new Intl.NumberFormat('en-IN');
const percentFormat = new Intl.NumberFormat('en', {
  style: 'percent',
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  day: 'numeric',
});

const palette = {
  accent: '#f5c84c',
  success: '#7cd7a8',
  muted: '#3b4a62',
  blue: '#83b5ff',
  line: '#cfd7e6',
  lineSoft: 'rgba(207, 215, 230, 0.16)',
};

function $(selector) {
  return document.querySelector(selector);
}

function createSvg(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
}

function formatNumber(value) {
  return numberFormat.format(Math.round(Number(value) || 0));
}

function formatScore(value) {
  return (Number(value) || 0).toFixed(2);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return dateFormat.format(date);
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function renderStatStrip(summary) {
  const strip = $('#stat-strip');
  const stats = summary.stats;
  if (!strip) return;

  const items = [
    ['Teams', `${formatNumber(stats.totalTeams)}`],
    ['Registered', `${formatNumber(stats.registeredTeams)}`],
    ['Participants', `${formatNumber(stats.totalParticipants)}`],
    ['Evaluated', `${formatNumber(summary.highlights.evaluatedTeams)}`],
  ];

  strip.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="stat-pill">
          <span>${label}</span>
          <strong>${value}</strong>
        </div>
      `
    )
    .join('');
}

function renderLegend(items, target) {
  target.innerHTML = items
    .map(
      (item) => `
        <div class="legend-item">
          <div class="legend-left">
            <span class="legend-swatch" style="background:${item.color}"></span>
            <span>${item.label}</span>
          </div>
          <strong>${formatNumber(item.value)}</strong>
        </div>
      `
    )
    .join('');
}

function renderDonutChart(svg, segments) {
  const total = segments.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
  const circumference = 2 * Math.PI * 80;
  const center = 130;

  svg.innerHTML = '';
  svg.appendChild(createSvg('circle', {
    cx: center,
    cy: center,
    r: 80,
    fill: 'none',
    stroke: 'rgba(255,255,255,0.08)',
    'stroke-width': 26,
  }));

  if (!total) {
    svg.appendChild(createSvg('text', {
      x: center,
      y: center,
      'text-anchor': 'middle',
      fill: '#a5b0c4',
      'font-size': 16,
      'font-weight': 700,
    }));
    svg.querySelector('text').textContent = 'No data yet';
    return;
  }

  let offset = 0;
  segments.forEach((segment) => {
    const segmentLength = circumference * (Math.max(0, Number(segment.value) || 0) / total);
    const circle = createSvg('circle', {
      cx: center,
      cy: center,
      r: 80,
      fill: 'none',
      stroke: segment.color,
      'stroke-width': 26,
      'stroke-linecap': 'round',
      transform: `rotate(-90 ${center} ${center})`,
      'stroke-dasharray': `${segmentLength} ${circumference - segmentLength}`,
      'stroke-dashoffset': `${-offset}`,
    });
    svg.appendChild(circle);
    offset += segmentLength;
  });

  svg.appendChild(createSvg('circle', {
    cx: center,
    cy: center,
    r: 54,
    fill: '#08111a',
  }));

  const title = createSvg('text', {
    x: center,
    y: 125,
    'text-anchor': 'middle',
    fill: '#edf3ff',
    'font-size': 22,
    'font-weight': 800,
  });
  title.textContent = formatNumber(total);

  const subtitle = createSvg('text', {
    x: center,
    y: 149,
    'text-anchor': 'middle',
    fill: '#a5b0c4',
    'font-size': 11,
    'letter-spacing': '0.12em',
    'text-transform': 'uppercase',
  });
  subtitle.textContent = 'Teams total';

  svg.appendChild(title);
  svg.appendChild(subtitle);
}

function renderBarChart(svg, items) {
  const width = 680;
  const height = Math.max(260, items.length * 34 + 70);
  const leftPad = 170;
  const topPad = 24;
  const bottomPad = 32;
  const chartWidth = width - leftPad - 30;
  const chartHeight = height - topPad - bottomPad;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  if (!items.length) {
    const empty = createSvg('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: '#a5b0c4',
      'font-size': 16,
      'font-weight': 700,
    });
    empty.textContent = 'No teams yet';
    svg.appendChild(empty);
    return;
  }

  const maxValue = Math.max(...items.map((item) => Number(item.participant_count) || 0), 1);
  const rowGap = 28;
  const barHeight = 16;

  for (let i = 0; i <= 4; i += 1) {
    const y = topPad + (chartHeight / 4) * i;
    svg.appendChild(createSvg('line', {
      x1: leftPad,
      y1: y,
      x2: width - 20,
      y2: y,
      stroke: 'rgba(255,255,255,0.06)',
      'stroke-width': 1,
    }));
  }

  items.forEach((item, index) => {
    const y = topPad + index * rowGap + 10;
    const barWidth = ((Number(item.participant_count) || 0) / maxValue) * chartWidth;

    const label = createSvg('text', {
      x: 10,
      y: y + 13,
      fill: '#edf3ff',
      'font-size': 13,
      'font-weight': 700,
    });
    label.textContent = item.team_name.length > 22 ? `${item.team_name.slice(0, 22)}…` : item.team_name;
    svg.appendChild(label);

    const meta = createSvg('text', {
      x: 10,
      y: y + 28,
      fill: '#a5b0c4',
      'font-size': 11,
    });
    meta.textContent = `Lab ${item.lab_no} | ${formatNumber(item.participant_count)} participants`;
    svg.appendChild(meta);

    svg.appendChild(createSvg('rect', {
      x: leftPad,
      y,
      width: chartWidth,
      height: barHeight,
      rx: 999,
      fill: 'rgba(255,255,255,0.06)',
    }));

    svg.appendChild(createSvg('rect', {
      x: leftPad,
      y,
      width: Math.max(barWidth, 4),
      height: barHeight,
      rx: 999,
      fill: index % 2 === 0 ? palette.accent : palette.blue,
    }));

    const badge = createSvg('text', {
      x: leftPad + Math.max(barWidth, 4) + 10,
      y: y + 13,
      fill: '#edf3ff',
      'font-size': 12,
      'font-weight': 700,
    });
    badge.textContent = formatNumber(item.participant_count);
    svg.appendChild(badge);
  });
}

function renderTimeline(svg, points) {
  const width = 860;
  const height = 320;
  const pad = { top: 24, right: 24, bottom: 48, left: 56 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = '';

  if (!points.length) {
    const empty = createSvg('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: '#a5b0c4',
      'font-size': 16,
      'font-weight': 700,
    });
    empty.textContent = 'Timeline appears after evaluations are saved';
    svg.appendChild(empty);
    return;
  }

  const values = points.map((point) => Number(point.value) || 0);
  const minValue = 0;
  const maxValue = Math.max(...values, 1);

  for (let i = 0; i <= 4; i += 1) {
    const value = maxValue - ((maxValue - minValue) / 4) * i;
    const y = pad.top + (chartHeight / 4) * i;

    svg.appendChild(createSvg('line', {
      x1: pad.left,
      y1: y,
      x2: width - pad.right,
      y2: y,
      stroke: palette.lineSoft,
      'stroke-width': 1,
    }));

    const label = createSvg('text', {
      x: pad.left - 10,
      y: y + 4,
      'text-anchor': 'end',
      fill: '#a5b0c4',
      'font-size': 11,
    });
    label.textContent = formatNumber(Math.round(value));
    svg.appendChild(label);
  }

  const step = points.length === 1 ? 0 : chartWidth / (points.length - 1);
  const coordinates = points.map((point, index) => {
    const value = Number(point.value) || 0;
    const x = pad.left + index * step;
    const y = pad.top + chartHeight - ((value - minValue) / (maxValue - minValue)) * chartHeight;
    return { ...point, x, y };
  });

  let path = '';
  coordinates.forEach((point, index) => {
    path += `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y} `;
  });

  const areaPath =
    `${path}L ${coordinates.at(-1).x} ${pad.top + chartHeight} L ${coordinates[0].x} ${pad.top + chartHeight} Z`;

  svg.appendChild(createSvg('path', {
    d: areaPath,
    fill: 'rgba(245, 200, 76, 0.09)',
  }));

  svg.appendChild(createSvg('path', {
    d: path.trim(),
    fill: 'none',
    stroke: palette.accent,
    'stroke-width': 3,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));

  coordinates.forEach((point) => {
    svg.appendChild(createSvg('circle', {
      cx: point.x,
      cy: point.y,
      r: 4.5,
      fill: palette.accent,
      stroke: '#08111a',
      'stroke-width': 2,
    }));
  });

  const labels = [coordinates[0], coordinates[Math.floor(coordinates.length / 2)], coordinates.at(-1)];
  labels.forEach((point) => {
    const text = createSvg('text', {
      x: point.x,
      y: height - 18,
      'text-anchor': 'middle',
      fill: '#a5b0c4',
      'font-size': 11,
    });
    text.textContent = point.label || '';
    svg.appendChild(text);
  });
}

function renderLeaderboard(items) {
  const target = $('#leaderboard');
  if (!target) return;

  if (!items.length) {
    target.innerHTML = '<div class="leader-card"><div class="leader-meta">No evaluations saved yet.</div></div>';
    return;
  }

  const maxScore = Math.max(...items.map((item) => Number(item.total) || 0), 1);

  target.innerHTML = items
    .map((item, index) => {
      const fill = Math.max((Number(item.total) || 0) / maxScore, 0.04) * 100;
      return `
        <article class="leader-card">
          <div class="leader-top">
            <div>
              <div class="leader-title">${index + 1}. ${item.team_name}</div>
              <div class="leader-meta">Lab ${item.lab_no} | ${formatNumber(item.participant_count)} participants</div>
            </div>
            <div class="score-badge">${formatScore(item.total)}</div>
          </div>
          <div class="score-track">
            <div class="score-fill" style="width:${fill}%;"></div>
          </div>
          <div class="leader-meta">
            E1 ${formatScore(item.evaluation_1)} · E2 ${formatScore(item.evaluation_2)} · Final ${formatScore(
              item.final_presentation
            )}
          </div>
        </article>
      `;
    })
    .join('');
}

function renderRecent(items) {
  const target = $('#recent-list');
  if (!target) return;

  if (!items.length) {
    target.innerHTML = '<div class="recent-card"><div class="recent-meta">No evaluation entries yet.</div></div>';
    return;
  }

  target.innerHTML = items
    .map(
      (item) => `
        <article class="recent-card">
          <div class="recent-top">
            <div class="recent-title">${item.team_name}</div>
            <div class="score-badge">${formatScore(item.total)}</div>
          </div>
          <div class="recent-meta">
            Lab ${item.lab_no} | ${formatScore(item.evaluation_1)} + ${formatScore(item.evaluation_2)} + ${formatScore(
              item.final_presentation
            )}
          </div>
          <div class="recent-meta">${item.evaluated_at ? `Updated ${formatDate(item.evaluated_at)}` : 'No timestamp'}</div>
        </article>
      `
    )
    .join('');
}

function updateStaticSummary(summary) {
  const stats = summary.stats;
  const totalTeams = Math.max(Number(stats.totalTeams) || 0, 1);
  const completion = percentFormat.format((Number(stats.registeredTeams) || 0) / totalTeams);
  setText('completion-value', completion);
  setText('average-score-value', formatScore(summary.highlights.averageScore));
  setText('top-team-value', summary.highlights.highestScore?.team_name || 'None yet');
  setText('last-sync-value', formatDate(summary.generatedAt));
}

function renderSummary(summary) {
  state.summary = summary;
  state.error = '';
  state.loading = false;
  log('RENDER_SUMMARY', {
    teams: summary?.stats?.totalTeams ?? 0,
    evaluatedTeams: summary?.highlights?.evaluatedTeams ?? 0,
    leaderboard: summary?.leaderboard?.length ?? 0,
  });

  const stats = summary.stats;
  const status = document.getElementById('backend-status');
  if (status) {
    status.textContent = summary.backendHealth?.mongoConnected ? 'Backend live' : 'Backend degraded';
    status.dataset.state = summary.backendHealth?.mongoConnected ? 'ok' : 'error';
  }

  renderStatStrip(summary);
  updateStaticSummary(summary);

  renderLegend(summary.charts.teamStatus, $('#team-legend'));
  renderDonutChart($('#team-donut'), summary.charts.teamStatus);
  renderBarChart($('#team-bars'), summary.charts.teamSizes);
  renderTimeline($('#timeline-chart'), summary.charts.timeline);
  renderLeaderboard(summary.leaderboard);
  renderRecent(summary.highlights.recentEvaluations);

  const statusNote = $('#status-note');
  if (statusNote) {
    statusNote.textContent = [
      `Backend ${summary.backendUrl}`,
      `Synced ${formatDate(summary.generatedAt)}`,
      `Teams ${formatNumber(stats.registeredTeams)}/${formatNumber(stats.totalTeams)}`,
      `Participants ${formatNumber(stats.registeredParticipants)}/${formatNumber(stats.totalParticipants)}`,
      `Evaluated ${formatNumber(summary.highlights.evaluatedTeams)}`,
    ].join(' | ');
  }
}

async function loadSummary() {
  const status = document.getElementById('backend-status');
  const refresh = document.getElementById('refresh-button');

  log('LOAD_START');

  if (status) {
    status.textContent = 'Loading';
    status.dataset.state = '';
  }

  if (refresh) {
    refresh.disabled = true;
    refresh.textContent = 'Refreshing';
  }

  try {
    const response = await fetch('/api/summary', { cache: 'no-store' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || 'Unable to load summary');
    }

    log('LOAD_SUCCESS', {
      teams: payload?.stats?.totalTeams ?? 0,
      evaluatedTeams: payload?.highlights?.evaluatedTeams ?? 0,
    });
    renderSummary(payload);
  } catch (error) {
    state.error = error.message || 'Unable to load dashboard';
    state.loading = false;
    log('LOAD_FAIL', {
      message: state.error,
    });

    if (status) {
      status.textContent = 'Offline';
      status.dataset.state = 'error';
    }

    const note = $('#status-note');
    if (note) {
      note.textContent = `Unable to load dashboard: ${state.error}`;
    }
  } finally {
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = 'Refresh';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  log('DOM_READY');
  const refresh = document.getElementById('refresh-button');
  if (refresh) {
    refresh.addEventListener('click', () => void loadSummary());
  }

  void loadSummary();
  window.setInterval(() => void loadSummary(), 30000);
});
