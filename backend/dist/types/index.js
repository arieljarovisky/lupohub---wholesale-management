"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrderStatus = exports.Role = void 0;
var Role;
(function (Role) {
    Role["ADMIN"] = "ADMIN";
    Role["SELLER"] = "SELLER";
    Role["WAREHOUSE"] = "WAREHOUSE";
    Role["CUSTOMER"] = "CUSTOMER";
})(Role || (exports.Role = Role = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["DRAFT"] = "Borrador";
    OrderStatus["CONFIRMED"] = "Confirmado";
    OrderStatus["PREPARING"] = "Preparando";
    OrderStatus["PENDING_CONTROL"] = "Falta controlar";
    OrderStatus["CONTROLLED"] = "Controlado";
    OrderStatus["DISPATCHED"] = "Despachado";
    OrderStatus["CANCELLED"] = "Cancelado";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
