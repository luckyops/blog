/* global hexo */

// 注册 head_end injector
hexo.extend.injector.register('head_end', () => {
  return '<link rel="stylesheet" href="/css/custom-style.css">';
}, 'default');

// 注册 body_begin injector
hexo.extend.injector.register('body_begin', () => {
  // 返回空字符串，或者您可以在这里添加其他想要注入的内容
  return '';
}, 'default');

// 注册 body_end injector
hexo.extend.injector.register('body_end', () => {
  return '<script src="//instant.page/5.2.0" type="module" integrity="sha384-jnZyxPjiipYXnSU0ygqeac2q7CVYMbh84q0uHVRRxEtvFPiQYbXWUorga2aqZJ0z"></script>';
}, 'default');
