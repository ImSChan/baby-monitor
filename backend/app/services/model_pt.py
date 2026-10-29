import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
import librosa
import model_runtime
from transformers import WavLMForSequenceClassification
from PIL import Image
import torch.nn as nn

# 이미지 데이터셋
class PersonalImageDataset(Dataset):
    def __init__(self, file_paths: list[str], labels: list[int]):
        self.file_paths = file_paths
        self.labels = labels
        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225],
            ),
        ])

    def __len__(self):
        return len(self.file_paths)

    def __getitem__(self, idx):
        path = self.file_paths[idx]
        label = self.labels[idx]
        
        image = Image.open(path).convert("RGB")
        tensor = self.transform(image)
        label_tensor = torch.tensor(label, dtype=torch.long)
        
        return tensor, label_tensor

# 이미지 데이터로더
def create_image_dataloader(file_paths: list[str], labels: list[int], batch_size: int = 8) -> DataLoader:
    dataset = PersonalImageDataset(file_paths, labels)
    
    return DataLoader(dataset, batch_size=batch_size, shuffle=True)

# 음성 데이터셋
class PersonalAudioDataset(Dataset):
    def __init__(self, file_paths: list[str], labels: list[int]):
        self.file_paths = file_paths
        self.labels = labels
        self.feature_extractor = model_runtime._feature_extractor

    def __len__(self):
        return len(self.file_paths)

    def __getitem__(self, idx):
        path = self.file_paths[idx]
        label = self.labels[idx]
        
        waveform, _ = librosa.load(path, sr=16000, mono=True)
        inputs = self.feature_extractor(
            waveform,
            sampling_rate=16000,
            return_tensors="pt",
            padding="max_length",
            max_length=80000,
            truncation=True
        )
        
        tensor = inputs.input_values.squeeze(0)
        label_tensor = torch.tensor(label, dtype=torch.long)
        
        return tensor, label_tensor

# 음성 데이터로더
def create_audio_dataloader(file_paths: list[str], labels: list[int], batch_size: int = 8) -> DataLoader:
    dataset = PersonalAudioDataset(file_paths, labels, model_runtime._feature_extractor)
    
    return DataLoader(dataset, batch_size=batch_size, shuffle=True)

# 데이터 로더 사용 예시
# dummy_image_paths = ["/app/data/user1/img1.jpg", "/app/data/user1/img2.jpg"]
# dummy_image_labels = [0, 2] 
# image_dataloader = create_image_dataloader(dummy_image_paths, dummy_image_labels)

# dummy_audio_paths = ["/app/data/user1/audio1.wav", "/app/data/user1/audio2.wav"]
# dummy_audio_labels = [1, 3] 
# audio_dataloader = create_audio_dataloader(dummy_audio_paths, dummy_audio_labels)


# 우선 데이터 로더로 데이터를 dataloader 형식으로 변경 후 학습.
# 개인화 오디오 학습
def train_personal_audio(user_pt_path: str, dataloader, epochs: int = 5) -> None:
    # 별도의 학습용 모델
    training_model = WavLMForSequenceClassification.from_pretrained(
        str(model_runtime.WAVLM_MODEL_DIR),
        num_labels=len(model_runtime.AUDIO_LABELS),
        ignore_mismatched_sizes=True,
    ).to(model_runtime.device)
    
    # 가중치 동결 및 분류기 학습 허용
    for param in training_model.wavlm.parameters():
        param.requires_grad = False
        
    classifier = training_model.classifier
    for param in classifier.parameters():
        param.requires_grad = True
        
    optimizer = torch.optim.Adam(classifier.parameters(), lr=1e-4)
    loss_fn = nn.CrossEntropyLoss()
    
    training_model.train()
    
    # 모델 학습
    for epoch in range(epochs):
        for inputs, labels in dataloader:
            inputs = inputs.to(model_runtime.device)
            labels = labels.to(model_runtime.device)
            
            optimizer.zero_grad()
            outputs = training_model(inputs)
            loss = loss_fn(outputs.logits, labels)
            
            loss.backward()
            optimizer.step()
            
    # 가중치 저장
    torch.save(classifier.state_dict(), user_pt_path)
    # 함수가 끝나면 training_model은 메모리에서 자동 해제됨


# 개인화 이미지 학습
def train_personal_image(user_pt_path: str, dataloader, epochs: int = 5) -> None:
    # 별도의 학습용 모델 로드 및 기존 가중치 덮어쓰기
    training_model = model_runtime.get_high_perf_model(len(model_runtime.IMAGE_LABELS))
    training_model.load_state_dict(
        torch.load(str(model_runtime.FACE_MODEL_PATH), map_location=model_runtime.device)
    )
    training_model = training_model.to(model_runtime.device)
    
    # 분류기 학습 허용 (get_high_perf_model에서 베이스는 이미 동결됨)
    classifier = training_model.classifier[1]
    for param in classifier.parameters():
        param.requires_grad = True
        
    optimizer = torch.optim.Adam(classifier.parameters(), lr=1e-4)
    loss_fn = nn.CrossEntropyLoss()
    
    training_model.train()
    
    # 모델 학습
    for epoch in range(epochs):
        for inputs, labels in dataloader:
            inputs = inputs.to(model_runtime.device)
            labels = labels.to(model_runtime.device)
            
            optimizer.zero_grad()
            outputs = training_model(inputs)
            loss = loss_fn(outputs, labels)
            
            loss.backward()
            optimizer.step()
            
    # 가중치 저장
    torch.save(classifier.state_dict(), user_pt_path)
