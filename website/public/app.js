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
  accent: '#e9c35b',
  success: '#7ed1b0',
  blue: '#91b7ff',
  muted: '#394351',
  lineSoft: 'rgba(233, 243, 248, 0.12)',
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

function formatPercent(value) {
  return percentFormat.format(Math.max(0, Math.min(1, Number(value) || 0)));
}

function median(values) {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function sum(values) {
  return values.reduce((acc, value) => acc + (Number(value) || 0), 0);
}

function buildHistogram(values, bucketCount = 6) {
  const cleaned = values.map((value) => Number(value) || 0).filter((value) => value >= 0);
  if (!cleaned.length) {
    return [];
  }

  const min = Math.min(...cleaned);
  const max = Math.max(...cleaned);
  if (min === max) {
    return [
      {
        label: `${formatScore(min)}`,
        value: cleaned.length,
        start: min,
        end: max,
      },
    ];
  }

  const buckets = Array.from({ length: bucketCount }, () => 0);
  const step = (max - min) / bucketCount;

  cleaned.forEach((value) => {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / step));
    buckets[index] += 1;
  });

  return buckets.map((count, index) => {
    const start = min + step * index;
    const end = index === bucketCount - 1 ? max : min + step * (index + 1);
    return {
      label: `${formatScore(start)}-${formatScore(end)}`,
      value: count,
      start,
      end,
    };
  });
}

function buildTimeline(evaluations) {
  const buckets = new Map();

  evaluations.forEach((entry) => {
    const source = entry.evaluated_at || entry.updatedAt;
    const date = new Date(source);
    if (Number.isNaN(date.getTime())) {
      return;
    }

    const key = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
      .toISOString()
      .slice(0, 10);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  });

  const ordered = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  let runningTotal = 0;

  return ordered.map(([date, count]) => {
    runningTotal += count;
    return {
      date,
      label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(`${date}T00:00:00Z`)),
      value: runningTotal,
      delta: count,
    };
  });
}

function revealChart(svg) {
  requestAnimationFrame(() => {
    svg.classList.add('is-visible');
  });
}

function renderStatStrip(summary) {
  const strip = $('#stat-strip');
  if (!strip) {
    return;
  }

  const stats = summary.stats;
  const items = [
    ['Teams', formatNumber(stats.totalTeams)],
    ['Check-ins', formatNumber(stats.registeredParticipants)],
    ['Evaluations', formatNumber(summary.derived.evaluatedTeams)],
    ['Avg score', formatScore(summary.derived.averageScore)],
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

function setBarWidth(id, ratio, variant = '') {
  const node = document.getElementById(id);
  if (!node) {
    return;
  }
  node.className = variant ? variant : '';
  requestAnimationFrame(() => {
    node.style.width = `${Math.max(0, Math.min(1, ratio || 0)) * 100}%`;
  });
}

function renderHeroSignals(summary) {
  const stats = summary.stats;
  const derived = summary.derived;

  setText('completion-value', formatPercent(derived.completionRate));
  setText('completion-meta', `Registered ${formatNumber(stats.registeredTeams)} of ${formatNumber(stats.totalTeams)} teams`);

  setText('participant-rate-value', formatPercent(derived.checkInRate));
  setText('participant-rate-meta', `${formatNumber(stats.registeredParticipants)} of ${formatNumber(stats.totalParticipants)} participants`);

  setText('coverage-value', formatPercent(derived.evaluationCoverage));
  setText('coverage-meta', `${formatNumber(derived.evaluatedTeams)} scored teams`);

  setText('average-score-value', formatScore(derived.averageScore));
  setText('score-meta', `Median ${formatScore(derived.medianScore)} | Range ${formatScore(derived.scoreSpread)}`);

  setText('last-sync-value', formatDate(summary.generatedAt));
}

function renderInsightCards(summary) {
  const stats = summary.stats;
  const derived = summary.derived;

  setText('teams-summary-value', formatNumber(stats.totalTeams));
  setText('teams-summary-meta', `Registered ${formatNumber(stats.registeredTeams)} | Pending ${formatNumber(stats.remainingTeams)}`);
  setBarWidth('teams-summary-bar', derived.completionRate, 'bar-sage');

  setText('participants-summary-value', formatNumber(stats.totalParticipants));
  setText(
    'participants-summary-meta',
    `Checked in ${formatNumber(stats.registeredParticipants)} | Waiting ${formatNumber(stats.remainingParticipants)}`
  );
  setBarWidth('participants-summary-bar', derived.checkInRate, 'bar-blue');

  setText('dinner-summary-value', formatNumber(stats.dinnerTaken));
  setText('dinner-summary-meta', `Dinner uptake ${formatPercent(derived.dinnerRate)}`);
  setBarWidth('dinner-summary-bar', derived.dinnerRate, 'bar-sage');

  setText('score-spread-value', formatScore(derived.scoreSpread));
  setText('score-spread-meta', `Average ${formatScore(derived.averageScore)} | Median ${formatScore(derived.medianScore)}`);
  setBarWidth('score-spread-bar', derived.scoreSpreadRatio, 'bar-blue');
}

function renderLegend(items, target) {
  if (!target) {
    return;
  }

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
  const total = segments.reduce((sumValue, item) => sumValue + Math.max(0, Number(item.value) || 0), 0);
  const circumference = 2 * Math.PI * 80;
  const center = 130;

  svg.classList.add('chart-stage');
  svg.innerHTML = '';

  svg.appendChild(createSvg('circle', {
    cx: center,
    cy: center,
    r: 80,
    fill: 'none',
    stroke: 'rgba(255,255,255,0.06)',
    'stroke-width': 24,
  }));

  if (!total) {
    const empty = createSvg('text', {
      x: center,
      y: center,
      'text-anchor': 'middle',
      fill: '#9fa8b7',
      'font-size': 15,
      'font-weight': 700,
      class: 'chart-label',
    });
    empty.textContent = 'No data yet';
    svg.appendChild(empty);
    revealChart(svg);
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
      'stroke-width': 24,
      'stroke-linecap': 'round',
      transform: `rotate(-90 ${center} ${center})`,
      'stroke-dasharray': `${segmentLength} ${circumference - segmentLength}`,
      'stroke-dashoffset': `${-offset}`,
      class: 'chart-slice',
    });
    svg.appendChild(circle);
    offset += segmentLength;
  });

  svg.appendChild(createSvg('circle', {
    cx: center,
    cy: center,
    r: 54,
    fill: '#0a0f15',
  }));

  const title = createSvg('text', {
    x: center,
    y: 126,
    'text-anchor': 'middle',
    fill: '#eef3f8',
    'font-size': 22,
    'font-weight': 800,
    class: 'chart-label',
  });
  title.textContent = formatNumber(total);

  const subtitle = createSvg('text', {
    x: center,
    y: 150,
    'text-anchor': 'middle',
    fill: '#9fa8b7',
    'font-size': 11,
    'letter-spacing': '0.12em',
    'text-transform': 'uppercase',
    class: 'chart-label',
  });
  subtitle.textContent = 'teams total';

  svg.appendChild(title);
  svg.appendChild(subtitle);
  revealChart(svg);
}

function renderBarChart(svg, items) {
  const width = 680;
  const height = Math.max(260, items.length * 34 + 72);
  const leftPad = 176;
  const topPad = 24;
  const bottomPad = 28;
  const chartWidth = width - leftPad - 28;
  const chartHeight = height - topPad - bottomPad;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('chart-stage');
  svg.innerHTML = '';

  if (!items.length) {
    const empty = createSvg('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: '#9fa8b7',
      'font-size': 15,
      'font-weight': 700,
      class: 'chart-label',
    });
    empty.textContent = 'No teams yet';
    svg.appendChild(empty);
    revealChart(svg);
    return;
  }

  const maxValue = Math.max(...items.map((item) => Number(item.participant_count) || 0), 1);
  const rowGap = 28;

  for (let i = 0; i <= 4; i += 1) {
    const y = topPad + (chartHeight / 4) * i;
    svg.appendChild(createSvg('line', {
      x1: leftPad,
      y1: y,
      x2: width - 20,
      y2: y,
      stroke: 'rgba(255,255,255,0.06)',
      'stroke-width': 1,
      class: 'chart-line',
    }));
  }

  items.forEach((item, index) => {
    const y = topPad + index * rowGap + 8;
    const barWidth = ((Number(item.participant_count) || 0) / maxValue) * chartWidth;

    const label = createSvg('text', {
      x: 10,
      y: y + 13,
      fill: '#eef3f8',
      'font-size': 13,
      'font-weight': 700,
      class: 'chart-label',
    });
    label.textContent = item.team_name.length > 20 ? `${item.team_name.slice(0, 20)}…` : item.team_name;
    svg.appendChild(label);

    const meta = createSvg('text', {
      x: 10,
      y: y + 29,
      fill: '#9fa8b7',
      'font-size': 11,
      class: 'chart-label',
    });
    meta.textContent = `Lab ${item.lab_no}`;
    svg.appendChild(meta);

    svg.appendChild(createSvg('rect', {
      x: leftPad,
      y,
      width: chartWidth,
      height: 15,
      rx: 999,
      fill: 'rgba(255,255,255,0.05)',
    }));

    svg.appendChild(createSvg('rect', {
      x: leftPad,
      y,
      width: Math.max(barWidth, 4),
      height: 15,
      rx: 999,
      fill: index % 2 === 0 ? palette.accent : palette.blue,
      class: 'chart-bar',
    }));

    const badge = createSvg('text', {
      x: leftPad + Math.max(barWidth, 4) + 10,
      y: y + 12,
      fill: '#eef3f8',
      'font-size': 12,
      'font-weight': 700,
      class: 'chart-label',
    });
    badge.textContent = formatNumber(item.participant_count);
    svg.appendChild(badge);
  });

  revealChart(svg);
}

function renderHistogram(svg, buckets) {
  const width = 680;
  const height = 320;
  const pad = { top: 24, right: 20, bottom: 48, left: 34 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('chart-stage');
  svg.innerHTML = '';

  if (!buckets.length) {
    const empty = createSvg('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: '#9fa8b7',
      'font-size': 15,
      'font-weight': 700,
      class: 'chart-label',
    });
    empty.textContent = 'No score data yet';
    svg.appendChild(empty);
    revealChart(svg);
    return;
  }

  const maxCount = Math.max(...buckets.map((bucket) => Number(bucket.value) || 0), 1);
  const gap = 14;
  const barWidth = (chartWidth - gap * (buckets.length - 1)) / buckets.length;

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (chartHeight / 4) * i;
    svg.appendChild(createSvg('line', {
      x1: pad.left,
      y1: y,
      x2: width - pad.right,
      y2: y,
      stroke: 'rgba(255,255,255,0.05)',
      'stroke-width': 1,
      class: 'chart-line',
    }));
  }

  buckets.forEach((bucket, index) => {
    const x = pad.left + index * (barWidth + gap);
    const barHeight = (Number(bucket.value) || 0) / maxCount * chartHeight;
    const top = pad.top + chartHeight - barHeight;

    svg.appendChild(createSvg('rect', {
      x,
      y: top,
      width: barWidth,
      height: Math.max(barHeight, 3),
      rx: 16,
      fill: index % 2 === 0 ? 'rgba(233, 195, 91, 0.92)' : 'rgba(126, 209, 176, 0.88)',
      class: 'chart-bar',
    }));

    const value = createSvg('text', {
      x: x + barWidth / 2,
      y: top - 8,
      'text-anchor': 'middle',
      fill: '#eef3f8',
      'font-size': 12,
      'font-weight': 700,
      class: 'chart-label',
    });
    value.textContent = formatNumber(bucket.value);
    svg.appendChild(value);

    const label = createSvg('text', {
      x: x + barWidth / 2,
      y: height - 18,
      'text-anchor': 'middle',
      fill: '#9fa8b7',
      'font-size': 11,
      class: 'chart-label',
    });
    label.textContent = bucket.label;
    svg.appendChild(label);
  });

  revealChart(svg);
}

function renderTimeline(svg, points) {
  const width = 860;
  const height = 320;
  const pad = { top: 24, right: 20, bottom: 48, left: 54 };
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('chart-stage');
  svg.innerHTML = '';

  if (!points.length) {
    const empty = createSvg('text', {
      x: width / 2,
      y: height / 2,
      'text-anchor': 'middle',
      fill: '#9fa8b7',
      'font-size': 15,
      'font-weight': 700,
      class: 'chart-label',
    });
    empty.textContent = 'Timeline appears after evaluations are saved';
    svg.appendChild(empty);
    revealChart(svg);
    return;
  }

  const values = points.map((point) => Number(point.value) || 0);
  const maxValue = Math.max(...values, 1);

  for (let i = 0; i <= 4; i += 1) {
    const value = maxValue - (maxValue / 4) * i;
    const y = pad.top + (chartHeight / 4) * i;

    svg.appendChild(createSvg('line', {
      x1: pad.left,
      y1: y,
      x2: width - pad.right,
      y2: y,
      stroke: 'rgba(255,255,255,0.05)',
      'stroke-width': 1,
      class: 'chart-line',
    }));

    const label = createSvg('text', {
      x: pad.left - 10,
      y: y + 4,
      'text-anchor': 'end',
      fill: '#9fa8b7',
      'font-size': 11,
      class: 'chart-label',
    });
    label.textContent = formatNumber(Math.round(value));
    svg.appendChild(label);
  }

  const step = points.length === 1 ? 0 : chartWidth / (points.length - 1);
  const coordinates = points.map((point, index) => {
    const value = Number(point.value) || 0;
    const x = pad.left + index * step;
    const y = pad.top + chartHeight - (value / maxValue) * chartHeight;
    return { ...point, x, y };
  });

  const pathData = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const areaData = `${pathData} L ${coordinates.at(-1).x} ${pad.top + chartHeight} L ${coordinates[0].x} ${
    pad.top + chartHeight
  } Z`;

  svg.appendChild(createSvg('path', {
    d: areaData,
    fill: 'rgba(233, 195, 91, 0.08)',
    class: 'chart-path',
  }));

  svg.appendChild(createSvg('path', {
    d: pathData,
    fill: 'none',
    stroke: 'rgba(233, 195, 91, 0.95)',
    'stroke-width': 3,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'chart-path',
  }));

  coordinates.forEach((point) => {
    svg.appendChild(createSvg('circle', {
      cx: point.x,
      cy: point.y,
      r: 4,
      fill: 'rgba(233, 195, 91, 0.95)',
      stroke: '#0a0f15',
      'stroke-width': 2,
      class: 'chart-dot',
    }));
  });

  const labels = [coordinates[0], coordinates[Math.floor(coordinates.length / 2)], coordinates.at(-1)];
  labels.forEach((point) => {
    if (!point) {
      return;
    }
    const text = createSvg('text', {
      x: point.x,
      y: height - 16,
      'text-anchor': 'middle',
      fill: '#9fa8b7',
      'font-size': 11,
      class: 'chart-label',
    });
    text.textContent = point.label || '';
    svg.appendChild(text);
  });

  revealChart(svg);
}

function renderLeaderboard(items) {
  const target = $('#leaderboard');
  if (!target) {
    return;
  }

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
            <div class="score-fill" style="width:${fill}%"></div>
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
  if (!target) {
    return;
  }

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

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) {
    node.textContent = value;
  }
}

function updateFooter(summary) {
  const note = $('#status-note');
  if (!note) {
    return;
  }

  const stats = summary.stats;
  note.textContent = [
    `Backend ${summary.backendUrl}`,
    `Synced ${formatDate(summary.generatedAt)}`,
    `Teams ${formatNumber(stats.registeredTeams)}/${formatNumber(stats.totalTeams)}`,
    `Participants ${formatNumber(stats.registeredParticipants)}/${formatNumber(stats.totalParticipants)}`,
    `Evaluated ${formatNumber(summary.derived.evaluatedTeams)}`,
  ].join(' | ');
}

function renderSummary(summary) {
  state.summary = summary;
  state.error = '';
  state.loading = false;

  log('RENDER_SUMMARY', {
    teams: summary?.stats?.totalTeams ?? 0,
    evaluatedTeams: summary?.derived?.evaluatedTeams ?? 0,
    leaderboard: summary?.leaderboard?.length ?? 0,
  });

  const status = document.getElementById('backend-status');
  if (status) {
    status.textContent = summary.backendHealth?.mongoConnected ? 'Backend live' : 'Backend degraded';
    status.dataset.state = summary.backendHealth?.mongoConnected ? 'ok' : 'error';
  }

  renderStatStrip(summary);
  renderHeroSignals(summary);
  renderInsightCards(summary);

  renderLegend(summary.charts.teamStatus, $('#team-legend'));
  renderDonutChart($('#team-donut'), summary.charts.teamStatus);
  renderBarChart($('#team-bars'), summary.charts.teamSizes);
  renderHistogram($('#score-distribution'), summary.charts.scoreDistribution);
  renderTimeline($('#timeline-chart'), summary.charts.timeline);
  renderLeaderboard(summary.leaderboard);
  renderRecent(summary.highlights.recentEvaluations);
  updateFooter(summary);
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
    refresh.textContent = 'Syncing';
  }

  try {
    const response = await fetch('/api/summary', { cache: 'no-store' });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error || 'Unable to load summary');
    }

    log('LOAD_SUCCESS', {
      teams: payload?.stats?.totalTeams ?? 0,
      evaluatedTeams: payload?.derived?.evaluatedTeams ?? 0,
    });
    renderSummary(payload);
  } catch (error) {
    state.error = error.message || 'Unable to load dashboard';
    state.loading = false;
    log('LOAD_FAIL', { message: state.error });

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
      refresh.textContent = 'Sync';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('is-ready');
  log('DOM_READY');

  const refresh = document.getElementById('refresh-button');
  if (refresh) {
    refresh.addEventListener('click', () => void loadSummary());
  }

  void loadSummary();
  window.setInterval(() => void loadSummary(), 30000);
});
