"""Local inference adapter for the VLSP2020 Vietnamese CTC checkpoint.

The checkpoint includes a three-stage feature projection before lm_head.
The generic Transformers class silently drops it. Keep its parameter names
and project each audio frame before the standard CTC head. No remote code runs.
Architecture reference: the checkpoint author's model_handling.py on Hugging Face.
"""
from collections import OrderedDict

from torch import nn
from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

MODEL_ID = 'nguyenvulebinh/wav2vec2-base-vi-vlsp2020'


class VietnameseWav2Vec2ForCTC(Wav2Vec2ForCTC):
    def __init__(self, config):
        super().__init__(config)
        layers = OrderedDict()
        for number in range(1, 4):
            layers['linear' + str(number)] = nn.Linear(config.hidden_size, config.hidden_size)
            layers['bn' + str(number)] = nn.BatchNorm1d(config.hidden_size)
            layers['activation' + str(number)] = nn.LeakyReLU()
            layers['drop' + str(number)] = nn.Dropout(config.final_dropout)
        self.feature_transform = nn.Sequential(layers)
        self.lm_head.register_forward_pre_hook(self._project_frames)

    def _project_frames(self, module, inputs):
        frames = inputs[0]
        projected = self.feature_transform(frames.reshape(-1, frames.shape[-1]))
        return (projected.reshape(frames.shape),)


def load_vietnamese_alignment(cache_dir):
    processor = Wav2Vec2Processor.from_pretrained(MODEL_ID, cache_dir=str(cache_dir))
    model, info = VietnameseWav2Vec2ForCTC.from_pretrained(
        MODEL_ID, cache_dir=str(cache_dir), output_loading_info=True)
    if info['missing_keys'] or info['unexpected_keys'] or info.get('mismatched_keys'):
        raise ValueError('Vietnamese alignment checkpoint architecture mismatch')
    model.eval()
    return model, {'language':'vi', 'type':'huggingface',
                   'dictionary':{char.lower():code for char,code in processor.tokenizer.get_vocab().items()}}
