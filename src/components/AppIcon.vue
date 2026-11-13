<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 18 },
  strokeWidth: { type: [Number, String], default: 1.8 },
})

const ICONS = {
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z', 'M21 21l-4.3-4.3'],
  settings: [
    'M3 7h6',
    'M13 7h8',
    'M11 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
    'M3 17h10',
    'M17 17h4',
    'M15 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4',
  ],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
    'M12 2v2',
    'M12 20v2',
    'M4.9 4.9l1.4 1.4',
    'M17.7 17.7l1.4 1.4',
    'M2 12h2',
    'M20 12h2',
    'M4.9 19.1l1.4-1.4',
    'M17.7 6.3l1.4-1.4',
  ],
  moon: ['M20.5 14.3A8.5 8.5 0 0 1 9.7 3.5a8.5 8.5 0 1 0 10.8 10.8Z'],
  monitor: ['M3 5h18v11H3z', 'M9 20h6', 'M12 16v4'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M6.5 7l1 13h9l1-13', 'M10 11v6', 'M14 11v6'],
  pin: ['M9 3h6l-1.2 6 4 4H6.2l4-4L9 3Z', 'M12 13v8'],
  edit: ['M12 20h9', 'M16.6 3.4a2.1 2.1 0 0 1 3 3L7.5 18.5 3 20l1.5-4.5L16.6 3.4Z'],
  copy: [
    'M9 9h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z',
    'M5 15V6a2 2 0 0 1 2-2h9',
  ],
  refresh: ['M20.5 12a8.5 8.5 0 1 1-2.5-6', 'M21 3v5h-5'],
  send: ['M21 3 10.5 13.5', 'M21 3l-6.8 18-3.7-8.5L2 8.8 21 3Z'],
  stop: ['M7 7h10v10H7z'],
  chevronDown: ['M6 9l6 6 6-6'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronLeft: ['M15 6l-6 6 6 6'],
  menu: ['M3 6h18', 'M3 12h18', 'M3 18h18'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 21h16'],
  check: ['M20 6 9 17l-5-5'],
  x: ['M18 6 6 18', 'M6 6l12 12'],
  sparkles: ['M12 3l2.2 6.1L20 11l-5.8 1.9L12 19l-2.2-6.1L4 11l5.8-1.9L12 3Z'],
  alert: ['M12 3 2.5 20.5h19L12 3Z', 'M12 9v5', 'M12 17.2v.2'],
  message: [
    'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l-2 2V11.5A7.5 7.5 0 0 1 10.5 4h2A7.5 7.5 0 0 1 20 11.5Z',
  ],
  bot: [
    'M12 3v3',
    'M8 8.5h8a3 3 0 0 1 3 3v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-4a3 3 0 0 1 3-3Z',
    'M9.6 13.2v.2',
    'M14.4 13.2v.2',
  ],
  cpu: [
    'M6.5 6.5h11v11h-11z',
    'M9.5 3v3.5',
    'M14.5 3v3.5',
    'M9.5 17.5V21',
    'M14.5 17.5V21',
    'M3 9.5h3.5',
    'M3 14.5h3.5',
    'M17.5 9.5H21',
    'M17.5 14.5H21',
  ],
  plug: ['M9 2v6', 'M15 2v6', 'M7 8h10v3.5a5 5 0 0 1-10 0V8Z', 'M12 16.5V19a3 3 0 0 1-3 3H7'],
  key: ['M15 4a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z', 'M11.5 9.5 3 18l2.5 2.5 2-2 2 2 2-2-2-2 2-2'],
  arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
  more: ['M6 12v.2', 'M12 12v.2', 'M18 12v.2'],
  fileText: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
  braces: [
    'M8 4H7a2 2 0 0 0-2 2v3.5A2.5 2.5 0 0 1 2.5 12 2.5 2.5 0 0 1 5 14.5V17a2 2 0 0 0 2 2h1',
    'M16 4h1a2 2 0 0 1 2 2v3.5A2.5 2.5 0 0 0 21.5 12 2.5 2.5 0 0 0 19 14.5V17a2 2 0 0 1-2 2h-1',
  ],
  zap: ['M13 2 4.5 14H10l-1 8 9-12h-5.5l1-8Z'],
  enter: ['M9 10 4 15l5 5', 'M4 15h11a5 5 0 0 0 5-5V6'],
  globe: [
    'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z',
    'M3.5 9h17',
    'M3.5 15h17',
    'M12 3a14 14 0 0 1 0 18',
    'M12 3a14 14 0 0 0 0 18',
  ],
  panelLeft: ['M3 4h18v16H3z', 'M9 4v16'],
  briefcase: ['M3 8h18v11H3z', 'M9 8V5h6v3', 'M3 12h18'],
  shield: ['M12 3 4.5 6v6.2c0 4.3 3.1 7.5 7.5 8.8 4.4-1.3 7.5-4.5 7.5-8.8V6L12 3Z', 'M9 12.2l2 2 4-4'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  box: [
    'M12 3 3.5 7.5v9L12 21l8.5-4.5v-9L12 3Z',
    'M3.5 7.5 12 12l8.5-4.5',
    'M12 12v9',
  ],
  // 新建窗口 / 工作区
  window: ['M3 5.5h18v13H3z', 'M3 9.5h18', 'M6.2 7.5v.2', 'M8.8 7.5v.2'],
}

const paths = computed(() => ICONS[props.name] || ICONS.sparkles)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
