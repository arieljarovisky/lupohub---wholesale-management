"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStatus = exports.Role = void 0;
var Role;
(function (Role) {
    Role["ADMIN"] = "ADMIN";
    Role["SELLER"] = "SELLER";
    Role["WAREHOUSE"] = "WAREHOUSE";
})(Role || (exports.Role = Role = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["DRAFT"] = "Borrador";
    OrderStatus["CONFIRMED"] = "Confirmado";
    OrderStatus["PREPARATION"] = "Preparaci\u00F3n";
    OrderStatus["DISPATCHED"] = "Despachado";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
