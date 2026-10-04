import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import AppRoot from './App.vue'
import { router } from './router/index'

createApp(AppRoot).use(ElementPlus).use(router).mount('#app')
