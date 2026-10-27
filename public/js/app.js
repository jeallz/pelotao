document.querySelectorAll('.file-drop input[type="file"]').forEach(input => {
  input.addEventListener('change', () => {
    const label = input.closest('.file-drop');
    const chosen = label.querySelector('.chosen-file');
    chosen.textContent = input.files && input.files.length ? input.files[0].name : 'Nenhum arquivo escolhido';
    label.classList.toggle('has-file', Boolean(input.files && input.files.length));
  });
});
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (button && !button.disabled) {
      button.dataset.originalText = button.innerHTML;
      button.disabled = true;
      button.classList.add('is-loading');
      button.innerHTML = '<span class="spinner"></span> Aguarde...';
    }
  });
});
