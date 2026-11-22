import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';
import { tip } from './composables/tip';

createApp(App).directive('tip', tip).mount('#app');
