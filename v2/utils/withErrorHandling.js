// v2/utils/withErrorHandling.js

const errorHandler = require('../middleware/errorHandlerV2');

function withErrorHandling(router) {
    // Проходим по всем "слоям" (маршрутам) роутера
    router.stack.forEach(layer => {
        // Убеждаемся, что это слой с определенным маршрутом (а не, например, app.use())
        if (layer.route) {
            // Стек обработчиков для этого конкретного маршрута
            const routeStack = layer.route.stack;
            
            // Нас интересует только самый последний обработчик - это наш контроллер
            if (routeStack.length > 0) {
                const controllerLayer = routeStack[routeStack.length - 1];
                const originalHandler = controllerLayer.handle;
                
                // Проверяем, что это функция и ее еще не обернули
                if (typeof originalHandler === 'function' && originalHandler.name !== 'errorHandlerWrapper') {
                     // Заменяем оригинальный контроллер на его обернутую версию
                     controllerLayer.handle = errorHandler(originalHandler);
                }
            }
        }
    });
    // Возвращаем измененный роутер для дальнейшего использования
    return router;
}

module.exports = withErrorHandling;