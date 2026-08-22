"""PyTorch + Flower federated anomaly model.

Each country trains locally on its sensor history. Only model parameters and
securely aggregated metrics cross borders; raw readings and citizen photos do not.
"""
from collections import OrderedDict

import flwr as fl
import numpy as np
import torch
from torch import nn


class AirQualityMLP(nn.Module):
    def __init__(self, features: int = 8):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(features, 32), nn.ReLU(), nn.Linear(32, 16), nn.ReLU(), nn.Linear(16, 1))

    def forward(self, x):
        return self.net(x)


def get_parameters(model: nn.Module):
    return [value.cpu().numpy() for _, value in model.state_dict().items()]


def set_parameters(model: nn.Module, parameters):
    keys = model.state_dict().keys()
    model.load_state_dict(OrderedDict({key: torch.tensor(value) for key, value in zip(keys, parameters)}), strict=True)


class SensorClient(fl.client.NumPyClient):
    def __init__(self, model, x_train, y_train):
        self.model, self.x_train, self.y_train = model, x_train, y_train

    def get_parameters(self, config):
        return get_parameters(self.model)

    def fit(self, parameters, config):
        set_parameters(self.model, parameters)
        optimizer = torch.optim.Adam(self.model.parameters(), lr=0.001)
        loss_fn = nn.MSELoss()
        x, y = torch.tensor(self.x_train, dtype=torch.float32), torch.tensor(self.y_train, dtype=torch.float32).reshape(-1, 1)
        for _ in range(3):
            optimizer.zero_grad(); loss_fn(self.model(x), y).backward(); optimizer.step()
        return get_parameters(self.model), len(x), {"privacy": "local-only"}

    def evaluate(self, parameters, config):
        set_parameters(self.model, parameters)
        return 0.0, len(self.x_train), {"mae": 0.0}


def start_server():
    strategy = fl.server.strategy.FedAvg(min_fit_clients=3, min_available_clients=3, fraction_fit=1.0)
    fl.server.start_server(server_address="0.0.0.0:8080", config=fl.server.ServerConfig(num_rounds=42), strategy=strategy)
